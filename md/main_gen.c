//`V+ 1.0.0  Место для автоматического заголовка
// Template: MyVersion
// Template version: 1.0.0
// Device: ATTINY1624
// Generated: 2025-12-30T14:40:50
//`V-
// User code can be plased here

//`P+   Место для параметров, выбранных пользователем
//$I @USART USART1 // поместить в программу
//$I @USART_LOCATION USART_LOCATION_DEFAULT  
// --- Selected parameters ---
// @USART = USART1
// @USART_LOCATION = USART_LOCATION_DEFAULT
//`P-
// User code can be plased here

//`D+   Место для Define
// ========================== Condition - условия и параметры
// ========= добавить сюда скорости, как параметры
#define BAUD_RATE 115200
#define CLK_PER 3333333UL // My clock 20 MHz - For the next string
#define USART_BAUD_RATE (((float) CLK_PER * 64.0 / (16.0 * (float)BAUD_RATE)) + 0.5)
// ========================= Шаблон программы
//`D-
// User code can be plased here

//`H+   Место для include
#include <xc.h>
#include <stdio.h>
//`H-
// User code can be plased here

//`C+   Место для описания функций
   // Начало раздела инициализации
// This my function is only envelope for other my function - USART0_sendChar(char c)
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
    PORTA.DIRSET |= PIN1_bm; //
    USART1.CTRLB |= USART_TXEN_bm;
    stdout = &USART_stream;
}
//`C-
// User code can be plased here

int main(void)
{
	//`I+   Место для запуска функций инициализации
	USART_Init();
	//`I-
	// User code can be plased here
	
	//`Csss   Место для автоматического добавления sei(); 
	while(1)
	{
		//`C+   Место для запуска функций инициализации
		//`C-
		// User code can be plased here
	}
    return 0;
}