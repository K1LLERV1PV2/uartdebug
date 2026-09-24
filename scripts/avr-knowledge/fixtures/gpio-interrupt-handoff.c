/* Exact compiler fixture for shared-vector acknowledgement and atomic handoff.
 * PA6 senses both edges with its pull-up enabled; PB1 is an active-low output.
 * Edge notifications coalesce; this is not debounce or lossless edge counting.
 * One-time startup after reset, ordinary CPUINT policy, no CPU-clock change.
 */
#include <xc.h>
#include <stdint.h>
#include <avr/interrupt.h>
#include <util/atomic.h>

static volatile uint8_t button_edge_pending;

static void gpio_init(void)
{
    PORTB.OUTSET = PIN1_bm;
    PORTB.DIRSET = PIN1_bm;

    PORTA.DIRCLR = PIN6_bm;
    PORTA.PIN6CTRL = PORT_PULLUPEN_bm | PORT_ISC_BOTHEDGES_gc;
    PORTA.INTFLAGS = PIN6_bm;
}

ISR(PORTA_PORT_vect)
{
    uint8_t pending = PORTA.INTFLAGS;

    if ((pending & PIN6_bm) != 0u)
    {
        PORTA.INTFLAGS = PIN6_bm;
        button_edge_pending = 1u;
    }
}

static uint8_t take_button_event(void)
{
    uint8_t pending;

    ATOMIC_BLOCK(ATOMIC_RESTORESTATE)
    {
        pending = button_edge_pending;
        button_edge_pending = 0u;
    }

    return pending;
}

int main(void)
{
    gpio_init();
    sei();

    while (1)
    {
        if (take_button_event() != 0u)
        {
            PORTB.OUTTGL = PIN1_bm;
        }
    }
}
