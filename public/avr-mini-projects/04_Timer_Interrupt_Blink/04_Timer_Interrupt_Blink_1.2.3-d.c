//# 04_Timer_Interrupt_Blink
//## File Version
// Version 1.2.3-d
//## Short Project Description
// Non-blocking LED blinking using TCA0 overflow interrupts.
//## Hardware Requirements and Setup


#include <xc.h>  //### Main Compiler Header


#include <avr/interrupt.h>  //### Interrupt Header

#define F_CPU 3333333UL  //### CPU Clock Definition

//### Timer Configuration Parameters
#define TCA_PRESCALER 1024UL   //### User-Defined Timer Parameters
#define TCA_PERIOD_US 500000UL //### User-Defined Timer Parameters

//### Timer Period Register Calculation
#define TCA_PER_VALUE \
    ((uint16_t)(((F_CPU / TCA_PRESCALER) * TCA_PERIOD_US) / 1000000UL - 1UL))

//### TCA0 Initialization
void Init_TCA(void)
{
    TCA0.SINGLE.CTRLB = TCA_SINGLE_WGMODE_NORMAL_gc;
    TCA0.SINGLE.INTCTRL = TCA_SINGLE_OVF_bm;
    TCA0.SINGLE.PER = TCA_PER_VALUE;

    TCA0.SINGLE.CTRLA =
            TCA_SINGLE_CLKSEL_DIV1024_gc |
            TCA_SINGLE_ENABLE_bm;
}

//### TCA0 Overflow Interrupt
ISR(TCA0_OVF_vect)
{
    PORTB.OUTTGL = PIN1_bm;
    TCA0.SINGLE.INTFLAGS = TCA_SINGLE_OVF_bm;  //#### TCA0 Overflow Interrupt Flag Reset
}

//### The Entry Point
int main(void)
{
    //### PB1 Output Initialization
    PORTB.OUTCLR = PIN1_bm;
    PORTB.DIRSET = PIN1_bm;

    Init_TCA();  //### Timer Initialization
    sei();       //### Global Interrupt Initialization

    //### Main Infinite Loop
    while (1)
    {

        //### Main-Loop Application Code

    }

    return 0;  //### This Code Is Never Reached
}
//## Quick Start
