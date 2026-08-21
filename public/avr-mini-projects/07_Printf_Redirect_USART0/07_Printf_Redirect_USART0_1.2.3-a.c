//# 07_Printf_Redirect_USART0
//## File Version
// Version 1.2.3-a
//## Short Project Description
// Redirect printf() output to UART0 for blocking text transmission.
//## Hardware Requirements and Setup

#include <xc.h>       //### Main Compiler Header
#include <stdio.h>    //### Standard I/O Library

#define F_CPU 3333333UL   //### CPU Clock Definition

#include <util/delay.h>   //### Delay Library

//### User-Defined UART Parameters
#define BAUD_RATE 115200UL
#define CLK_PER   F_CPU

//### USART Baud Register Calculation
#define USART_BAUD_RATE \
    ((uint16_t)(((float)CLK_PER * 64.0 / (16.0 * (float)BAUD_RATE)) + 0.5))

//### printf Character Output Function
int USART_PrintChar(char c, FILE *stream)
{
    while (!(USART0.STATUS & USART_DREIF_bm)) //### Data Register Empty Check
    {
        ;
    }

    USART0.TXDATAL = c; //### Character Transmission

    return 0;
}

//### printf Output Stream
FILE USART_stream = FDEV_SETUP_STREAM(USART_PrintChar, NULL, _FDEV_SETUP_WRITE);

//### USART0 Initialization
void USART_Init(void)
{
    //#### UART Frame Format
    USART0.CTRLC = USART_CMODE_ASYNCHRONOUS_gc |
                   USART_PMODE_DISABLED_gc |
                   USART_CHSIZE_8BIT_gc |
                   USART_SBMODE_1BIT_gc;

    USART0.BAUD = USART_BAUD_RATE;       //#### USART Baud Rate Register
    PORTB.DIRSET = PIN2_bm;              //#### UART0 TxD Pin Configuration
    USART0.CTRLB = USART_TXEN_bm;        //#### USART Transmitter Enable
    stdout = &USART_stream;               //#### stdout Redirection
}

//### UART1 Initialization Note

int main(void) //### The Entry Point
{
    uint16_t tr_count = 0; //### Transmission Counter Variable

    USART_Init(); //### USART0 Initialization Call

    while (1) //### Main Infinite Loop
    {
        printf("Counter = %u\r\n", tr_count); //### Formatted Text Transmission

        tr_count++; //### Counter Increment

        _delay_ms(500); //### Transmission Interval
    }

    return 0;
}
//## Quick Start
