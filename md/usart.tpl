$V 1.0.0  MyVersion
$N USART|USART0|USART1|UART|UART0|UART1 
$D ATTINY1624

$S @USART USART0|USART1 1 "Номер порта"  //
$S @USART_LOCATION USART_LOCATION_DEFAULT|USART_LOCATION_ALTERNATIVE

$S+ @TXD_LOCATION 
	?USART0 PORTB.DIRSET |= PIN2_bm; // 
	?USART1 PORTA.DIRSET |= PIN1_bm; // 
$S- @TXD_LOCATION 

// ========================== Condition - условия и параметры
$P //$I @USART USART0 // поместить в программу
$P //$I @USART_LOCATION USART_LOCATION_DEFAULT  

$H #include <xc.h>
$H #include <stdio.h>
// ========= добавить сюда скорости, как параметры
#define BAUD_RATE 115200
#define CLK_PER 3333333UL // My clock 20 MHz - For the next string
#define USART_BAUD_RATE (((float) CLK_PER * 64.0 / (16.0 * (float)BAUD_RATE)) + 0.5)

// ========================= Шаблон программы
$C+   // Начало раздела инициализации
// This my function is only envelope for other my function - USART0_sendChar(char c)
int USART_printChar(char c, FILE *stream) {
    while (!(@USART.STATUS & USART_DREIF_bm)) {
        ;
    }
    @USART.TXDATAL = c;
    return 0;
}
FILE USART_stream = FDEV_SETUP_STREAM(USART_printChar, NULL, _FDEV_SETUP_WRITE);  // stdio.h
// @USART - Output PA1 - pin 11
// Redirection to the stdout
void USART_Init(void) {
    @USART.CTRLC |= USART_CMODE_ASYNCHRONOUS_gc | USART_PMODE_DISABLED_gc | USART_CHSIZE_8BIT_gc | USART_SBMODE_1BIT_gc;
    @USART.BAUD = USART_BAUD_RATE;
    @TXD_LOCATION
    @USART.CTRLB |= USART_TXEN_bm;
    stdout = &USART_stream;
}
$C- // Завершение раздела инициализации

$I USART_Init(); 