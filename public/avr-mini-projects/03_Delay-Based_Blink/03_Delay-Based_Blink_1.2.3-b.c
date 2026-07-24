//# 03_Delay-Based_Blink
//## File Version
// Version 1.2.3-b
//## Short Project Description
// LED blinking is the “Hello, World!” of microcontroller programming.
//## Hardware Requirements and Setup

#include <xc.h> //### Main Compiler Header

#define F_CPU 3333333UL  //### CPU Clock Definition

#include <util/delay.h>  //### Delay Library


int main(void) //### The Entry Point
{

    //### Configure PB1 as an Output
    PORTB.OUTCLR = PIN1_bm;
    PORTB.DIRSET = PIN1_bm;
    
    while (1)  //### Main Infinite Loop
    {
        
        PORTB.OUTTGL = PIN1_bm;  //### Toggle the LED
        _delay_ms(500);  //### Software Delay

    }
    
    return 0; //### This Code Is Never Reached
}
//## Quick Start
