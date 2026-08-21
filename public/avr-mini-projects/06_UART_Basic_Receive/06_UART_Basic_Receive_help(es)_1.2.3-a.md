# 06_UART_Basic_Receive
Recepción básica de datos mediante UART

## File Version
Versión del archivo

Version 1.2.3-a

## Short Project Description
Descripción breve del proyecto

Recepción básica de un byte mediante UART0 y transmisión de una respuesta usando sondeo.

## Full Mini-Project Description
Descripción completa del miniproyecto

Este miniproyecto inicializa UART0 para comunicación bidireccional.

El microcontrolador espera hasta recibir un byte mediante UART0. Después lee el byte recibido, incrementa su valor en `1`, espera hasta que el búfer de transmisión pueda aceptar otro byte y envía el resultado de vuelta mediante UART0.

El proyecto utiliza recepción y transmisión UART basadas en sondeo. El bucle principal queda bloqueado mientras espera un byte recibido y también puede esperar hasta que el transmisor esté preparado.

Formato UART:

```text
115200 baud, 8 data bits, no parity, 1 stop bit
```

Notación habitual:

```text
115200 8N1
```

Los datos transmitidos y recibidos pueden observarse en la sección UART de **uartdebug.com**.

## Hardware Requirements and Setup
Requisitos de hardware y conexión

La configuración prevista utiliza dos adaptadores USB-UART:

- un adaptador para la programación mediante UPDI;
- un segundo adaptador para la comunicación bidireccional UART0 con el programa en ejecución.

Conexiones del segundo adaptador:

```text
Microcontroller PB2 / TxD  ->  USB-UART RxD
Microcontroller PB3 / RxD  <-  USB-UART TxD
Microcontroller GND        ->  USB-UART GND
```

El microcontrolador y el segundo adaptador USB-UART deben utilizar el mismo nivel de tensión lógica.

Para dispositivos tinyAVR 2-series en encapsulado SOIC-14:

```text
PB2 / UART0 TxD  ->  pin 7
PB3 / UART0 RxD  ->  pin 6
```

En este miniproyecto se necesitan tanto `TxD` como `RxD`, porque los datos se transfieren en ambas direcciones.

## Quick Start
Inicio rápido

### Hardware Connection
Conexión del hardware

Conecte el primer adaptador USB-UART al microcontrolador para programarlo mediante la interfaz UPDI.

Conecte el segundo adaptador USB-UART al microcontrolador para la comunicación UART0:

```text
PB2 / TxD  ->  USB-UART RxD
PB3 / RxD  <-  USB-UART TxD
GND        ->  USB-UART GND
```

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

#### UART Communication Adapter Port Selection
Selección del puerto del adaptador para comunicación UART

En otra pestaña del navegador, abra la sección UART de **uartdebug.com** para comunicarse con el programa en ejecución.

La figura muestra que inicialmente no hay ningún puerto seleccionado.

![668](Pasted%20image%2020260726152507.png)

Después de pulsar el botón `Disconnected`, aparece la ventana de selección de puerto.

![355](Pasted%20image%2020260726152540.png)

Seleccione el puerto del segundo adaptador conectado a UART0 y pulse el botón `Connection`.

Tenga en cuenta que debe ser un número de puerto diferente. En este ejemplo, el adaptador UPDI utiliza `COM15`, mientras que el segundo adaptador para comunicación UART utiliza `COM24`.

Si todo funciona correctamente, verá aproximadamente lo siguiente:

![501](Pasted%20image%2020260726152615.png)

La indicación más importante es `Connected` en el botón. Esto significa que la conexión se realizó correctamente.

El texto `WCH CH343 ...` puede ser diferente en su ordenador. Depende del fabricante del adaptador USB-UART.

La configuración UART predeterminada tiene los valores correctos para este proyecto: `115200 8N1`.

Programe el microcontrolador con este proyecto.

### Sending Test Data
Envío de datos de prueba

En la sección UART de **uartdebug.com**, transmita un byte.

El microcontrolador recibe el byte, incrementa su valor en `1` y envía el resultado de vuelta.

Por ejemplo:

```text
Transmit: 100
Receive:  101
```

También puede utilizar el modo HEX. Por ejemplo:

```text
Transmit: 64
Receive:  65
```

### Verification
Verificación

Si cada byte transmitido vuelve con su valor incrementado en `1`, la recepción y transmisión de UART0 funcionan correctamente.

Esto verifica:

- la recepción UART0;
- la transmisión UART0;
- las conexiones físicas `TxD` y `RxD`;
- la comunicación UART bidireccional.

## What This Mini-Project Is For
Para qué sirve este miniproyecto

Este miniproyecto demuestra:

- la inicialización de UART0 para recepción y transmisión;
- el sondeo de la bandera de recepción completa;
- la lectura de un byte desde `USART0.RXDATAL`;
- el sondeo de la bandera de disponibilidad del búfer de transmisión;
- la escritura de un byte en `USART0.TXDATAL`;
- la forma más sencilla de comunicación UART bidireccional bloqueante.

Es el siguiente paso natural después del Proyecto 05, que demuestra únicamente la transmisión UART.

## Usage Options
Opciones de uso

Puede:

- enviar diferentes valores de byte y observar el resultado devuelto;
- utilizar el modo HEX para observar valores de byte sin procesar;
- cambiar `received_byte + 1` por otra operación sencilla, como `received_byte + 2`;
- seleccionar otra velocidad estándar compatible; al cambiar la velocidad, cambie también la configuración UART en **uartdebug.com**;
- utilizar UART1 en lugar de UART0; esto requiere cambios en el código y conectar el segundo adaptador a los pines UART1;
- cambiar la frecuencia de la CPU como se muestra en el Proyecto 02; actualice `F_CPU` en este proyecto para que coincida con la nueva frecuencia.

## Common Mistakes
Errores frecuentes

- Conectar `TxD` del microcontrolador a `TxD` del adaptador en lugar de a `RxD`.
- Conectar `RxD` del microcontrolador a `RxD` del adaptador en lugar de a `TxD`.
- Olvidar la conexión común de `GND`.
- Utilizar niveles de tensión lógica diferentes.
- Seleccionar el puerto COM incorrecto.
- Seleccionar el mismo puerto COM para ambos adaptadores.
- Seleccionar una velocidad incorrecta.

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

`F_CPU` se utiliza en el cálculo de la velocidad UART.

Con la configuración de reloj de fábrica, la frecuencia de la CPU es aproximadamente 3,333 MHz.

Esta definición no configura el reloj de hardware.

### Delay Library
Biblioteca de retardos

```c
#include <util/delay.h>
```

Este archivo de cabecera proporciona `_delay_ms()` y `_delay_us()`.

El programa actual no llama a estas funciones de retardo, pero el archivo de cabecera se conserva en la estructura de proyecto proporcionada.

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
#define USART_BAUD_RATE \
    ((uint16_t)(((float)CLK_PER * 64.0 / (16.0 * (float)BAUD_RATE)) + 0.5))
```

Esta expresión calcula el valor escrito en `USART0.BAUD`.

La expresión en coma flotante y la suma de `0.5` redondean el resultado al entero más cercano.

### USART0 Initialization
Inicialización de USART0

`USART_Init()` configura UART0 antes de la recepción y transmisión.

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

Para dispositivos tinyAVR 2-series en encapsulado SOIC-14, `PB2` corresponde al pin 7.

UART0 `RxD` es `PB3`, pin 6 en el mismo encapsulado. Se utiliza como entrada de recepción.

#### USART Transmitter and Receiver Enable
Habilitación del transmisor y receptor USART

```c
USART0.CTRLB = USART_TXEN_bm | USART_RXEN_bm;
```

Esta operación habilita tanto el transmisor como el receptor USART0.

### UART1 Initialization Note
Nota de inicialización de UART1

Para convertir el ejemplo a UART1:

1. Sustituya `USART0.` por `USART1.`.
2. Sustituya `PORTB.DIRSET = PIN2_bm;` por `PORTA.DIRSET = PIN1_bm;`.

Para los dispositivos tinyAVR 2-series previstos en encapsulado SOIC-14:

```text
PA1 / UART1 TxD  ->  pin 11
PA2 / UART1 RxD  ->  pin 12
```

### The Entry Point
Punto de entrada

`int main(void)` es el punto de entrada del programa.

### Received Byte Variable
Variable del byte recibido

```c
uint8_t received_byte;
```

Esta variable almacena el byte leído del registro de datos de recepción de USART0.

### USART0 Initialization Call
Llamada de inicialización de USART0

```c
USART_Init();
```

UART0 se configura antes de iniciar el bucle principal.

### Main Infinite Loop
Bucle principal infinito

El bucle `while (1)` repite continuamente la operación de recepción y respuesta.

### Receive Complete Check
Comprobación de recepción completa

```c
while (!(USART0.STATUS & USART_RXCIF_bm))
{
    ;
}
```

Este bucle de sondeo espera hasta que USART0 haya recibido un byte.

Como el bucle es bloqueante, la CPU permanece aquí hasta que haya un byte disponible.

### Received Byte Read
Lectura del byte recibido

```c
received_byte = USART0.RXDATAL;
```

Esta operación lee el byte recibido del registro de datos de recepción de USART0.

### Data Register Empty Check
Comprobación de registro de datos vacío

```c
while (!(USART0.STATUS & USART_DREIF_bm))
{
    ;
}
```

Este bucle de sondeo espera hasta que el búfer de transmisión pueda aceptar otro byte.

### Incremented Byte Transmission
Transmisión del byte incrementado

```c
USART0.TXDATAL = received_byte + 1;
```

Esta operación incrementa el valor del byte recibido en `1` y escribe el resultado en el registro de datos de transmisión de USART0.

### Application Scope
Ámbito de aplicación

Este miniproyecto está destinado a dispositivos tinyAVR 2-series con registros USART y de enrutamiento de pines compatibles.

### Tested Hardware
Hardware probado

- `ATtiny1624`, SOIC-14
