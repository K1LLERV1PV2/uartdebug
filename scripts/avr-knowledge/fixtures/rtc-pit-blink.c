/* Compile fixture for ATtiny1624/1626/1627, not hardware timing evidence.
 * Board: VDD -> current-limiting resistor -> LED -> PB1 (active low).
 * PIT uses nominal INT32K: 4096 / 32768 Hz = 125 ms per toggle.
 * The first PIT condition may occur anywhere in the first nominal period;
 * oscillator error and interrupt latency also affect observed transitions.
 * One-time startup after reset only: no earlier RTC/PIT owner or clock setup.
 * The CPU clock, fuses, RTC counter and calibration remain unchanged.
 */
#include <xc.h>
#include <avr/interrupt.h>

#define LED_PIN_bm PIN1_bm

static void led_init(void)
{
    PORTB.OUTSET = LED_PIN_bm;
    PORTB.DIRSET = LED_PIN_bm;
}

static void pit_init_after_reset(void)
{
    /* Called once before sei(), while reset RTCEN and PITEN are both zero.
     * CLKSEL is shared with the RTC counter; this is not a reinit routine.
     */
    RTC.CLKSEL = RTC_CLKSEL_INT32K_gc;
    RTC.PITINTFLAGS = RTC_PI_bm;
    RTC.PITINTCTRL = RTC_PI_bm;

    while ((RTC.PITSTATUS & RTC_CTRLBUSY_bm) != 0u) {}
    RTC.PITCTRLA = RTC_PERIOD_CYC4096_gc | RTC_PITEN_bm;
    while ((RTC.PITSTATUS & RTC_CTRLBUSY_bm) != 0u) {}
}

ISR(RTC_PIT_vect)
{
    RTC.PITINTFLAGS = RTC_PI_bm;
    PORTB.OUTTGL = LED_PIN_bm;
}

int main(void)
{
    led_init();
    pit_init_after_reset();
    sei();

    while (1) {}
}
