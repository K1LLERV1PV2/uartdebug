//# 09_UART0_Interrupt_Transmission
//## File Version
// Version 1.2.3-a
//## Short Project Description
// Non-blocking UART0 buffer transmission using the Data Register Empty interrupt.
//## Hardware Requirements and Setup

#include <xc.h>             //### Main Compiler Header
// #include <avr/io.h>      // Alternative header for AVR-GCC compiler

#define F_CPU 3333333UL     //### CPU Clock Definition

#include <util/delay.h>     //### Delay Library
#include <avr/interrupt.h>  //### Interrupt Library
#include <stdio.h>          //### Standard I/O Library

//### User-Defined UART Parameters
#define BAUD_RATE 115200UL
#define CLK_PER   F_CPU

//### USART Baud Register Calculation
#define USART_BAUD_RATE \
    ((uint16_t)(((float)CLK_PER * 64.0 / (16.0 * (float)BAUD_RATE)) + 0.5))

volatile uint8_t out_data = 0;

//### USART0 Initialization
void USART_Init(void)
{
    //#### UART Frame Format
    USART0.CTRLC = USART_CMODE_ASYNCHRONOUS_gc |
                   USART_PMODE_DISABLED_gc |
                   USART_CHSIZE_8BIT_gc |
                   USART_SBMODE_1BIT_gc;

    USART0.BAUD = USART_BAUD_RATE;    //#### USART Baud Rate Register
    PORTB.DIRSET = PIN2_bm;           //#### UART0 TxD Pin Configuration
    USART0.CTRLB = USART_TXEN_bm;     //#### USART Transmitter Enable

//    USART0.CTRLA = USART_DREIE_bm;
}

//### Transmission State Variables
static volatile uint8_t current_tx_byte_count;
static volatile uint8_t *current_tx_ptr;

//### Transmission Buffer
uint8_t tx_buffer[100];

//### UART0 Data Register Empty ISR
ISR(USART0_DRE_vect)
{
    USART0.TXDATAL = *current_tx_ptr; //### Byte Transmission
    current_tx_ptr++;                 //### Transmission Pointer Advance
    current_tx_byte_count--;          //### Remaining Byte Count
    if (current_tx_byte_count == 0)
        USART0.CTRLA &= ~USART_DREIE_bm; //### DRE Interrupt Disable
}

//### Buffer Transmission Start
void USART_SendBuffer(uint8_t *buffer, uint8_t length)
{
    current_tx_byte_count = length;
    current_tx_ptr = buffer;
    USART0.CTRLA |= USART_DREIE_bm;
}

//### High-Byte-First uint16 Transmission
void send_uint16_High_Low(uint16_t observed_value)
{
    tx_buffer[0] = (uint8_t)(observed_value >> 8);
    tx_buffer[1] = (uint8_t)(observed_value);
    USART_SendBuffer(tx_buffer, 2);
}

//### High-Byte-First uint32 Transmission
void send_uint32_High_Low(uint32_t observed_value)
{
    tx_buffer[0] = (uint8_t)(observed_value >> 24);
    tx_buffer[1] = (uint8_t)(observed_value >> 16);
    tx_buffer[2] = (uint8_t)(observed_value >> 8);
    tx_buffer[3] = (uint8_t)observed_value;
    USART_SendBuffer(tx_buffer, 4);
}

//### Little-Endian uint16 Transmission
void send_uint16_Low_High(uint16_t observed_value)
{
    tx_buffer[0] = (uint8_t)observed_value;
    tx_buffer[1] = (uint8_t)(observed_value >> 8);
    USART_SendBuffer(tx_buffer, 2);
}

int main(void) //### The Entry Point
{
//  volatile uint16_t test_var = 0x1234;

    USART_Init(); //### USART0 Initialization Call

    sei(); //### Global Interrupt Enable

    while (1) //### Main Infinite Loop
    {
        //### snprintf Message Construction
        uint8_t tx_byte_count;
        tx_byte_count = snprintf((char *)tx_buffer, (size_t)sizeof(tx_buffer), "Register = 0x%X\r\n", 0x1234);
        USART_SendBuffer(tx_buffer, tx_byte_count); //### Buffer Transmission Request

    /*
     * Example of uint16_t for viewing in a serial terminal.
     *
     * uint16_t test_var = 0x1234;
     * send_uint16_High_Low(test_var); // 2-byte variable
     *
    */

    /*
     * Example of uint32_t for viewing in a serial terminal.
     *
     * uint32_t test_var = 0x12345678;
     * send_uint32_High_Low(test_var); // 4-byte variable
     *
    */

    /*
     * Example of uint16_t sending in native little-endian order by USART_SendBuffer(...)
     *
     * uint16_t test_var = 0x1234;
     * USART_SendBuffer((uint8_t *)&test_var, 2); // 2-byte variable
     *
    */

        _delay_ms(200); //### Transmission Interval
    }

    return 0;
}
//## Quick Start
