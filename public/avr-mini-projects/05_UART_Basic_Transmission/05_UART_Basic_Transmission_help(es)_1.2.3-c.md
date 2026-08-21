# 05_UART_Basic_Transmission
Transmisión básica de datos mediante UART

## File Version
Versión del archivo

Version 1.2.3-c

## Short Project Description
Descripción breve del proyecto

Transmisión básica de bytes mediante UART0 con sondeo del estado y un retardo bloqueante entre los bytes transmitidos.

## Full Mini-Project Description
Descripción completa del miniproyecto

Este miniproyecto inicializa UART0 y transmite un byte aproximadamente cada 20 ms.

Después de cada transmisión, el valor del byte aumenta. Después de `255`, el valor de tipo `uint8_t` vuelve automáticamente a `0`, produciendo una secuencia repetitiva en diente de sierra de `0` a `255`.

El proyecto utiliza transmisión UART basada en sondeo. Antes de escribir en `USART0.TXDATAL`, el programa espera hasta que el búfer de transmisión pueda aceptar otro byte.

El intervalo de 20 ms se crea mediante `_delay_ms(20)`, por lo que el bucle principal queda bloqueado durante este retardo.

Formato UART:

```text
115200 baud, 8 data bits, no parity, 1 stop bit
```

Notación habitual:

```text
115200 8N1
```

Los datos transmitidos pueden observarse en la sección UART de **uartdebug.com**.

## Hardware Requirements and Setup
Requisitos de hardware y conexión

La configuración prevista utiliza dos adaptadores USB-UART:

- un adaptador para la programación mediante UPDI;
- un segundo adaptador para observar la transmisión de UART0.

Conexiones del segundo adaptador:

```text
Microcontroller PB2 / TxD  ->  USB-UART RxD
Microcontroller GND        ->  USB-UART GND
```

El microcontrolador y el adaptador USB-UART receptor deben utilizar el mismo nivel de tensión lógica.

Para los dispositivos tinyAVR 2-series en encapsulado SOIC-14, `PB2` corresponde al pin 7.

El pin `RxD` del microcontrolador no se utiliza. Para observar la transmisión, conecte únicamente `TxD` y el `GND` común.

## Quick Start
Inicio rápido

### Hardware Connection
Conexión del hardware

Conecte el primer adaptador USB-UART al microcontrolador para programarlo mediante la interfaz UPDI.

Conecte el segundo adaptador USB-UART al microcontrolador para observar los datos transmitidos.

### Port Selection
Selección de puertos

#### UPDI Programmer Adapter Port Selection
Selección del puerto del adaptador programador UPDI

En una pestaña del navegador, abra la sección AVR de **uartdebug.com** para programar el microcontrolador.

La figura muestra que inicialmente no hay ningún puerto seleccionado.

![472](Pasted%20image%2020260726152153.png)

Después de pulsar el botón `Disconnected`, aparece la ventana de selección de puerto.

Seleccione el puerto del primer adaptador conectado a la interfaz de programación UPDI del microcontrolador.

![387](Pasted%20image%2020260726152302.png)

Si el adaptador está conectado correctamente al microcontrolador y se seleccionó el puerto correcto, después de pulsar el botón `Connection` verá aproximadamente lo siguiente:

- el botón muestra `Connected`;
- se muestra el nombre del microcontrolador conectado, en este ejemplo `ATtiny1624`;
- el nombre situado junto al botón es el nombre del microcontrolador detectado automáticamente y su descriptor, es decir, el código del chip asignado por el fabricante;
- el nombre situado junto al botón `Compile` es la opción del compilador.

![466](Pasted%20image%2020260726152346.png)

#### UART Observation Adapter Port Selection
Selección del puerto del adaptador para observar UART

En otra pestaña del navegador, abra la sección UART de **uartdebug.com** para observar los datos transmitidos.

La figura muestra que inicialmente no hay ningún puerto seleccionado.

![668](Pasted%20image%2020260726152507.png)

Después de pulsar el botón `Disconnected`, aparece la ventana de selección de puerto.

![355](Pasted%20image%2020260726152540.png)

Seleccione el puerto del segundo adaptador conectado al transmisor UART0 del microcontrolador y pulse el botón `Connection`.

Tenga en cuenta que debe ser un número de puerto diferente. En este ejemplo, el adaptador UPDI utiliza `COM15`, mientras que el segundo adaptador para observar UART utiliza `COM24`.

Si todo funciona correctamente, verá aproximadamente lo siguiente:

![501](Pasted%20image%2020260726152615.png)

La indicación más importante es `Connected` en el botón. Esto significa que la conexión se realizó correctamente.

El texto `WCH CH343 ...` puede ser diferente en su ordenador. Depende del fabricante del adaptador USB-UART.

La configuración UART predeterminada tiene los valores correctos para este proyecto: `115200 8N1`.

Programe el microcontrolador con este proyecto.

En la pestaña UART, observe los datos recibidos.

Modos recomendados de **uartdebug.com**:

- **Graphic → Unsigned → 1 byte** — señal repetitiva en diente de sierra;
- **Data → HEX** — valores hexadecimales de `00` a `FF`.

## What This Mini-Project Is For
Para qué sirve este miniproyecto

Este miniproyecto demuestra:

- la inicialización de UART0;
- la transmisión directa de un byte;
- el sondeo de la bandera de disponibilidad del búfer de transmisión;
- la escritura en `USART0.TXDATAL`;
- la generación de una secuencia repetitiva de bytes;
- la visualización de datos UART sin procesar en forma gráfica y HEX.

Es la prueba práctica de transmisión más sencilla antes de los proyectos UART basados en interrupciones.

## Usage Options
Opciones de uso

Puede:

- generar una secuencia de datos transmitidos diferente de la secuencia en diente de sierra utilizada en este proyecto;
- seleccionar otra velocidad estándar compatible; al cambiar la velocidad, cambie también el ajuste de recepción en la sección UART de **uartdebug.com**;
- utilizar UART1 en lugar de UART0; esto requiere cambios en el código y conectar el segundo adaptador a otra salida del microcontrolador;
- cambiar la frecuencia de la CPU como se muestra en el Proyecto 02; actualice `F_CPU` en este proyecto para que coincida con la nueva frecuencia.

## Common Mistakes
Errores frecuentes

- Conectar `TxD` a `TxD` del adaptador en lugar de a `RxD`.
- Olvidar la conexión común de `GND`.
- Utilizar niveles de tensión lógica diferentes.
- Seleccionar el puerto COM incorrecto.
- Seleccionar una velocidad incorrecta.
- Olvidar que `_delay_ms(20)` bloquea el bucle principal.

## Code Description
Descripción del código

### Main Compiler Header
Archivo de cabecera principal del compilador

`#include <xc.h>` proporciona definiciones de registros y bits específicas del dispositivo para XC8.

### CPU Clock Definition
Definición de la frecuencia de la CPU

```c
#define F_CPU 3333333UL
```

`F_CPU` se utiliza en la biblioteca de retardos y en el cálculo de la velocidad UART.

Con la configuración de reloj de fábrica, la frecuencia de la CPU es aproximadamente 3,333 MHz.

Esta definición no configura el reloj de hardware.

### Delay Library
Biblioteca de retardos

```c
#include <util/delay.h>
```

Este archivo de cabecera proporciona `_delay_ms()` y `_delay_us()`.

`F_CPU` debe definirse antes de incluir este archivo de cabecera.

### User-Defined UART Parameters
Parámetros UART definidos por el usuario

```c
#define BAUD_RATE 115200UL
#define CLK_PER   F_CPU
```

`BAUD_RATE` lo selecciona el usuario.

`CLK_PER` es el reloj periférico utilizado en el cálculo de velocidad. Aquí es igual a `F_CPU`.

### USART Baud Register Calculation
Cálculo del registro de velocidad USART

```c
#define USART_BAUD_RATE     ((uint16_t)(((float)CLK_PER * 64.0 / (16.0 * (float)BAUD_RATE)) + 0.5))
```

Esta expresión calcula el valor escrito en `USART0.BAUD`.

La expresión en coma flotante y la suma de `0.5` redondean el resultado al entero más cercano.

### USART0 Initialization
Inicialización de USART0

`USART_Init()` configura UART0 antes de la transmisión.

#### UART Frame Format
Formato de trama UART

La asignación a `USART0.CTRLC` selecciona modo asíncrono, sin paridad, 8 bits de datos y 1 bit de parada: `8N1`.

#### USART Baud Rate Register
Registro de velocidad USART

```c
USART0.BAUD = USART_BAUD_RATE;
```

Este registro configura el generador de velocidad de USART. Con el reloj actual y el valor de `BAUD_RATE`, proporciona aproximadamente 115200 baudios.

#### UART0 TxD Pin Configuration
Configuración del pin TxD de UART0

```c
PORTB.DIRSET = PIN2_bm;
```

PB2 se configura como salida de transmisión de UART0.

Para los dispositivos tinyAVR 2-series en encapsulado SOIC-14, `PB2` corresponde al pin 7.

#### USART Transmitter Enable
Habilitación del transmisor USART

```c
USART0.CTRLB = USART_TXEN_bm;
```

Esta operación habilita el transmisor USART0.

### UART1 Initialization Note
Nota de inicialización de UART1

Para convertir el ejemplo a UART1:

1. Sustituya `USART0.` por `USART1.`.
2. Sustituya `PORTB.DIRSET = PIN2_bm;` por `PORTA.DIRSET = PIN1_bm;`.

Para los dispositivos tinyAVR 2-series previstos en encapsulado SOIC-14, `TxD` de UART1 se encuentra en `PA1`, pin 11.

### The Entry Point
Punto de entrada

`int main(void)` es el punto de entrada del programa.

### Output Data Variable
Variable de datos de salida

```c
uint8_t out_data = 0;
```

Esta variable almacena el siguiente byte transmitido. Después de `255`, vuelve automáticamente a `0`.

### USART0 Initialization Call
Llamada de inicialización de USART0

```c
USART_Init();
```

UART0 se configura antes de iniciar el bucle principal.

### Main Infinite Loop
Bucle principal infinito

El bucle `while (1)` repite continuamente la secuencia de transmisión.

### Data Register Empty Check
Comprobación de registro de datos vacío

```c
while (!(USART0.STATUS & USART_DREIF_bm))
{
    ;
}
```

Este bucle de sondeo espera hasta que el búfer de transmisión pueda aceptar otro byte.

Con un intervalo de 20 ms, el búfer normalmente ya está preparado, pero la comprobación mantiene el funcionamiento correcto si se reduce el intervalo.

### Byte Transmission
Transmisión de un byte

```c
USART0.TXDATAL = out_data;
```

Esta operación coloca un byte en el búfer de transmisión USART.

### Output Data Increment
Incremento de los datos de salida

```c
out_data++;
```

La secuencia transmitida se repite de `0` a `255`.

### Transmission Interval
Intervalo de transmisión

```c
_delay_ms(20);
```

Esta función crea un intervalo de aproximadamente 20 ms entre bytes y bloquea el bucle principal.

A `115200 8N1`, la transmisión física de un byte dura aproximadamente 87 µs.

### Application Scope
Ámbito de aplicación

Este miniproyecto está destinado a dispositivos tinyAVR 2-series con registros USART y de enrutamiento de pines compatibles.

### Tested Hardware
Hardware probado

- `ATtiny1624`, SOIC-14
