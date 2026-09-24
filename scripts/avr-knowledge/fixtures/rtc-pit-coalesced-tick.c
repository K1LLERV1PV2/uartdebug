/* ATtiny1624, SOIC-14: active-low LED on PB1 (package pin 8).
 * One-time startup after reset; CPU clock remains unchanged.
 */
#include <xc.h>
#include <stdint.h>
#include <avr/interrupt.h>
#include <util/atomic.h>

static volatile uint8_t tick_pending;
/* Main-only counter retained for debugger inspection; wraps modulo 2^32. */
static volatile uint32_t diagnostic_consumed_ticks;

static void led_init(void)
{
    PORTB.OUTSET = PIN1_bm;
    PORTB.DIRSET = PIN1_bm;
}

static void pit_init(void)
{
    /* RTC/PIT and correction are still in their disabled reset state. */
    RTC.CLKSEL = RTC_CLKSEL_INT32K_gc;

    RTC.PITINTFLAGS = RTC_PI_bm;
    RTC.PITINTCTRL = RTC_PI_bm;

    while ((RTC.PITSTATUS & RTC_CTRLBUSY_bm) != 0u) {}
    RTC.PITCTRLA = RTC_PERIOD_CYC4096_gc | RTC_PITEN_bm;
    while ((RTC.PITSTATUS & RTC_CTRLBUSY_bm) != 0u) {}
}

static uint8_t take_tick(void)
{
    uint8_t pending;

    ATOMIC_BLOCK(ATOMIC_RESTORESTATE)
    {
        pending = tick_pending;
        tick_pending = 0u;
    }

    return pending;
}

ISR(RTC_PIT_vect)
{
    RTC.PITINTFLAGS = RTC_PI_bm;
    PORTB.OUTTGL = PIN1_bm;
    tick_pending = 1u;
}

int main(void)
{
    led_init();
    pit_init();

    sei();

    while (1)
    {
        if (take_tick() != 0u)
        {
            diagnostic_consumed_ticks++;
        }
    }
}
