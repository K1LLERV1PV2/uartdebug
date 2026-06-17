//`V+ 1.0.0  Auto-generated header section
// Template: MyVersion
// Template version: 1.0.0
// Device: ATTINY1624
// Generated: 2025-12-30T14:40:50
//`V-
// User code can be placed here

//`P+   User-selected parameters section
//$I @USART USART1 // Insert into the program.
//$I @USART_LOCATION USART_LOCATION_DEFAULT  
// --- Selected parameters ---
// @USART = USART1
// @USART_LOCATION = USART_LOCATION_DEFAULT
//`P-
// User code can be placed here

//`D+   Define section
// ========================== Conditions and parameters
// ========= Add baud rates here as parameters.
#define BAUD_RATE 115200
#define CLK_PER 3333333UL // My clock 20 MHz - For the next string
#define USART_BAUD_RATE (((float) CLK_PER * 64.0 / (16.0 * (float)BAUD_RATE)) + 0.5)
// ========================= Program template
//`D-
// User code can be placed here

//`H+   Include section
#include <xc.h>
#include <stdio.h>
//`H-
// User code can be placed here

//`C+   Function definition section
   // Start of the initialization section.
// This function wraps USART0_sendChar(char c).
int USART_printChar(char c, FILE *stream) {
    while (!(USART1.STATUS & USART_DREIF_bm)) {
        ;
    }
    USART1.TXDATAL = c;
    return 0;
}
FILE USART_stream = FDEV_SETUP_STREAM(USART_printChar, NULL, _FDEV_SETUP_WRITE);  // stdio.h
// USART1 - Output PA1 - pin 11
// Redirection to the stdout
void USART_Init(void) {
    USART1.CTRLC |= USART_CMODE_ASYNCHRONOUS_gc | USART_PMODE_DISABLED_gc | USART_CHSIZE_8BIT_gc | USART_SBMODE_1BIT_gc;
    USART1.BAUD = USART_BAUD_RATE;
    PORTA.DIRSET |= PIN1_bm;
    USART1.CTRLB |= USART_TXEN_bm;
    stdout = &USART_stream;
}
//`C-
// User code can be placed here

int main(void)
{
	//`I+   Initialization call section
	USART_Init();
	//`I-
	// User code can be placed here
	
	//`Csss   Auto-generated sei() insertion section
	while(1)
	{
		//`C+   Loop body section
		//`C-
		// User code can be placed here
	}
    return 0;
}
