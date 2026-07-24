//# 02_CPU_Clock
//## File Version
// Version 1.2.3-b
//## Short Project Description
// CPU clock configuration examples for 20 MHz, 10 MHz and so on. 
//## Hardware Requirements and Setup

#include <xc.h> //### Main Compiler Header

//### 20 MHz Clock With PB5 Output
void CPU_Max_Clock_20MHz_Out(void)
{
    _PROTECTED_WRITE(CLKCTRL.MCLKCTRLA,
                     CLKCTRL_CLKSEL_OSC20M_gc | CLKCTRL_CLKOUT_bm);

    _PROTECTED_WRITE(CLKCTRL.MCLKCTRLB, 0);
}

//### 20 MHz Clock Without Output
void CPU_Max_Clock_20MHz_NoOutputSignal(void)
{
    _PROTECTED_WRITE(CLKCTRL.MCLKCTRLA, CLKCTRL_CLKSEL_OSC20M_gc);

    _PROTECTED_WRITE(CLKCTRL.MCLKCTRLB, 0);
}

//### 10 MHz Clock Without Output
void CPU_Clock_10MHz_NoOutputSignal(void)
{
    _PROTECTED_WRITE(CLKCTRL.MCLKCTRLA, CLKCTRL_CLKSEL_OSC20M_gc);

    _PROTECTED_WRITE(CLKCTRL.MCLKCTRLB,
                     CLKCTRL_PDIV_2X_gc | CLKCTRL_PEN_bm);
}


int main(void) //### The Entry Point
{
    
    CPU_Max_Clock_20MHz_NoOutputSignal(); //### CPU Clock Selection
    //### Your Initialization Code Can Be Placed Here

    while (1) //### Main Infinite Loop
    {

        //### Your Repeated Code Can Be Placed Here

    }
    
    return 0; //### This Code Is Never Reached
}
//## Quick Start
