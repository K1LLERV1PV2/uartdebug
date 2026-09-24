/* Compile regression, not a hardware certification or a complete board project.
 * OSC20M / 1; PB0 status LED; USART0 PB2/PB3 DRE TX + polling RX;
 * USART1 PA1/PA2 polling + printf. All pins exist on all three pilot MCUs.
 * Board prerequisites: OSC20M fuse selects 20 MHz; VDD = 4.5..5.5 V and
 * ambient temperature = -40..85 C (DS40002234B p476). This fixture does not
 * program fuses or measure the board. OSCLOCK remains disabled.
 */
#define F_CPU 20000000UL
#include <xc.h>
#include <stdint.h>
#include <stdbool.h>
#include <stdio.h>
#include <avr/interrupt.h>
#include <util/atomic.h>
#include <util/delay.h>

#define UART_BAUD_VALUE 694u
#define TIMER_PER_VALUE 9765u
#define TX_CAPACITY 48u

static volatile uint16_t tick_count;
static const uint8_t * volatile tx_ptr;
static volatile uint8_t tx_remaining;
/* Only main writes this storage, and only after tx_remaining becomes zero. */
static uint8_t tx_storage[TX_CAPACITY];
static volatile uint8_t last_rx;
static volatile uint8_t last_rx_errors;

static void clock_init(void)
{
    _PROTECTED_WRITE(CLKCTRL.MCLKCTRLA, CLKCTRL_CLKSEL_OSC20M_gc);
    _PROTECTED_WRITE(CLKCTRL.MCLKCTRLB, 0); /* PEN=0; F_CPU matches CLK_PER. */
}

static void peripherals_init(void)
{
    PORTB.OUTCLR = PIN0_bm;
    PORTB.DIRSET = PIN0_bm;
    PORTMUX.USARTROUTEA = (PORTMUX.USARTROUTEA &
        (uint8_t)~(PORTMUX_USART0_gm | PORTMUX_USART1_gm)) |
        PORTMUX_USART0_DEFAULT_gc | PORTMUX_USART1_DEFAULT_gc;

    USART0.CTRLA = 0;
    USART0.CTRLB = 0;
    USART1.CTRLA = 0;
    USART1.CTRLB = 0;
    USART0.CTRLC = USART_CMODE_ASYNCHRONOUS_gc | USART_PMODE_DISABLED_gc |
        USART_CHSIZE_8BIT_gc | USART_SBMODE_1BIT_gc;
    USART1.CTRLC = USART0.CTRLC;
    USART0.BAUD = UART_BAUD_VALUE;
    USART1.BAUD = UART_BAUD_VALUE;
    PORTB.OUTSET = PIN2_bm;
    PORTB.DIRSET = PIN2_bm;
    PORTB.DIRCLR = PIN3_bm;
    PORTA.OUTSET = PIN1_bm;
    PORTA.DIRSET = PIN1_bm;
    PORTA.DIRCLR = PIN2_bm;
    /* Active, push-pull 8N1: SFDEN and ODME remain zero (DS80000902F p5). */
    USART0.CTRLB = USART_RXMODE_NORMAL_gc | USART_TXEN_bm | USART_RXEN_bm;
    USART1.CTRLB = USART_RXMODE_NORMAL_gc | USART_TXEN_bm | USART_RXEN_bm;

    TCA0.SINGLE.CTRLA = 0;
    TCA0.SINGLE.CTRLB = TCA_SINGLE_WGMODE_NORMAL_gc;
    TCA0.SINGLE.CNT = 0;
    TCA0.SINGLE.PER = TIMER_PER_VALUE;
    TCA0.SINGLE.INTFLAGS = TCA_SINGLE_OVF_bm;
    TCA0.SINGLE.INTCTRL = TCA_SINGLE_OVF_bm;
    TCA0.SINGLE.CTRLA = TCA_SINGLE_CLKSEL_DIV1024_gc | TCA_SINGLE_ENABLE_bm;
}

ISR(TCA0_OVF_vect)
{
    TCA0.SINGLE.INTFLAGS = TCA_SINGLE_OVF_bm;
    PORTB.OUTTGL = PIN0_bm;
    ++tick_count;
}

ISR(USART0_DRE_vect)
{
    if (tx_remaining != 0) {
        USART0.TXDATAL = *tx_ptr++;
        --tx_remaining;
    }
    if (tx_remaining == 0) USART0.CTRLA &= (uint8_t)~USART_DREIE_bm;
}

/* Single main-loop producer. Buffer stays immutable until remaining == 0.
 * Completion here releases source storage, not the physical serial line. */
static bool uart0_send(const uint8_t *data, uint8_t length)
{
    bool accepted = false;
    if (data == 0 || length == 0 || length > TX_CAPACITY) return false;
    ATOMIC_BLOCK(ATOMIC_RESTORESTATE) {
        if (tx_remaining == 0) {
            tx_ptr = data;
            tx_remaining = length;
            USART0.CTRLA |= USART_DREIE_bm;
            accepted = true;
        }
    }
    return accepted;
}

static int uart1_putchar(char ch, FILE *stream)
{
    (void)stream;
    while (!(USART1.STATUS & USART_DREIF_bm)) { }
    USART1.TXDATAL = (uint8_t)ch;
    return 0;
}
static FILE uart1_stdout = FDEV_SETUP_STREAM(uart1_putchar, NULL, _FDEV_SETUP_WRITE);

/* 8-bit frame mode: capture RXDATAH error metadata before RXDATAL pops it. */
static void poll_receiver(volatile USART_t *uart)
{
    if (uart->STATUS & USART_RXCIF_bm) {
        const uint8_t high = uart->RXDATAH;
        const uint8_t data = uart->RXDATAL;
        last_rx_errors = high & (USART_BUFOVF_bm | USART_FERR_bm | USART_PERR_bm);
        if (last_rx_errors == 0) last_rx = data;
    }
}

int main(void)
{
    uint16_t seen = 0;
    clock_init();
    peripherals_init();
    stdout = &uart1_stdout;
    sei();
    printf("clock=%lu\r\n", (unsigned long)F_CPU);
    while (1) {
        uint16_t now;
        ATOMIC_BLOCK(ATOMIC_RESTORESTATE) { now = tick_count; }
        poll_receiver(&USART0);
        poll_receiver(&USART1);
        if (now != seen && tx_remaining == 0) {
            const int length = snprintf((char *)tx_storage, sizeof tx_storage,
                "tick=%u\r\n", (unsigned int)now);
            if (length > 0 && (size_t)length < sizeof tx_storage &&
                uart0_send(tx_storage, (uint8_t)length)) seen = now;
        }
        _delay_us(1);
    }
}
