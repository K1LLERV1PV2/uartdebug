//# 05_UART_Basic_Transmission
//## File Version
// Version 1.2.3-c
//## Short Project Description
// Basic UART0 byte transmission using polling and a blocking delay.
//## Hardware Requirements and Setup

#include <xc.h>       //### Main Compiler Header

#define F_CPU 3333333UL   //### CPU Clock Definition

#include <util/delay.h>   //### Delay Library

//### User-Defined UART Parameters
#define BAUD_RATE 115200UL
#define CLK_PER   F_CPU

//### USART Baud Register Calculation
#define USART_BAUD_RATE \
    ((uint16_t)(((float)CLK_PER * 64.0 / (16.0 * (float)BAUD_RATE)) + 0.5))

//### USART0 Initialization
void USART_Init(void)
{
    //#### UART Frame Format
    USART0.CTRLC = USART_CMODE_ASYNCHRONOUS_gc |
                   USART_PMODE_DISABLED_gc |
                   USART_CHSIZE_8BIT_gc |
                   USART_SBMODE_1BIT_gc;
    
    USART0.BAUD = USART_BAUD_RATE;   //#### USART Baud Rate Register
    PORTB.DIRSET = PIN2_bm;          //#### UART0 TxD Pin Configuration
    USART0.CTRLB = USART_TXEN_bm;    //#### USART Transmitter Enable
}

//### UART1 Initialization Note

int main(void) //### The Entry Point
{
    uint8_t out_data = 0; //### Output Data Variable

    USART_Init(); //### USART0 Initialization Call

    while (1) //### Main Infinite Loop
    {
        
        while (!(USART0.STATUS & USART_DREIF_bm))   //### Data Register Empty Check
        {
            ;
        }

        USART0.TXDATAL = out_data; //### Byte Transmission

        out_data++; //### Output Data Increment

        _delay_ms(20); //### Transmission Interval
    }

    return 0; 
}
//## Hardware Requirements and Setup
//## Quick Start
