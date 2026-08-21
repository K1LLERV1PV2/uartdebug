# 04_Timer_Interrupt_Blink
Parpadeo del LED mediante interrupción del temporizador

## File Version
Versión del archivo

Version 1.2.3-d

## Short Project Description
Descripción breve del proyecto

Parpadeo no bloqueante de un LED mediante interrupciones periódicas de desbordamiento de TCA0.

## Full Mini-Project Description
Descripción completa del miniproyecto

Este miniproyecto configura el temporizador TCA0 de 16 bits para generar una interrupción de desbordamiento aproximadamente cada 0,5 segundos.

Dentro de la rutina de servicio de interrupción se conmuta PB1. Por lo tanto, un LED conectado a PB1 cambia de estado en cada interrupción. Un ciclo completo de encendido y apagado dura aproximadamente 1 segundo.

A diferencia de la implementación basada en retardos del miniproyecto 03, este programa no mantiene el bucle principal dentro de un retardo por software. El bucle principal queda disponible para el código de la aplicación, aunque se interrumpe brevemente cada vez que se ejecuta la ISR del temporizador.

### User-Defined Timer Parameters
Parámetros del temporizador definidos por el usuario

`F_CPU` especifica la frecuencia de la CPU utilizada para calcular el período del temporizador. Con la configuración de reloj de fábrica, este valor es `3333333UL`, aproximadamente 3,333 MHz. Esta definición no configura el reloj de hardware.

`TCA_PRESCALER` es el factor numérico de división del reloj del temporizador seleccionado por el usuario. Debe ser uno de los valores de división compatibles con TCA0. Selecciónelo de modo que el valor calculado de `TCA_PER_VALUE` quepa en el registro `PER` de 16 bits. Un valor excesivamente pequeño de `TCA_PER_VALUE` reduce la resolución temporal disponible.

`TCA_PERIOD_US` es el intervalo requerido de la interrupción del temporizador en microsegundos. Este valor lo selecciona el usuario.

`TCA_PER_VALUE` es el valor que se escribe en el registro de período del temporizador. En este miniproyecto se calcula automáticamente a partir de `F_CPU`, `TCA_PRESCALER` y `TCA_PERIOD_US`.

Con los parámetros seleccionados, el intervalo real de interrupción es aproximadamente `0,4998 s`.

## Hardware Requirements and Setup
Requisitos de hardware y conexión

Se requieren un LED y una resistencia limitadora de corriente adecuada.

Conecte el circuito del LED a `PB1` respetando la polaridad del esquema elegido.

Para el ATtiny1624 en encapsulado SOIC-14, `PB1` corresponde al pin 8.

## Quick Start
Inicio rápido

1. Conecte un LED y una resistencia limitadora de corriente a `PB1`.
2. Compile y programe el miniproyecto.
3. Observe el LED.
4. El LED debe cambiar de estado aproximadamente cada 0,5 segundos.
5. Un ciclo completo de parpadeo debe durar aproximadamente 1 segundo.

El funcionamiento correcto confirma que TCA0, la interrupción de desbordamiento, la ISR, la habilitación global de interrupciones y la salida PB1 trabajan conjuntamente.

Para el ATtiny1624 en encapsulado SOIC-14, conecte el circuito del LED al pin 8 (`PB1`).

## What This Mini-Project Is For
Para qué sirve este miniproyecto

Este miniproyecto demuestra:

- interrupciones periódicas del temporizador TCA0;
- temporización no bloqueante;
- la estructura de una rutina de servicio de interrupción;
- el control de GPIO desde una ISR;
- la habilitación global de interrupciones mediante `sei()`;
- la disponibilidad del bucle principal para otras tareas.

Puede servir como punto de partida para tareas periódicas en segundo plano que no requieran un retardo por software bloqueante.

## Usage Options
Opciones de uso

Puede:

- cambiar `TCA_PERIOD_US` para seleccionar otro período de interrupción;
- seleccionar otro preescalador compatible de TCA;
- trasladar la salida a otro pin GPIO;
- sustituir la conmutación del LED por otra operación periódica breve;
- añadir código de aplicación al bucle principal, incluso código que bloquee el bucle principal, siempre que no deshabilite las interrupciones globales.

Cuando cambie la frecuencia de la CPU, actualice `F_CPU`.

Mantenga cortas las rutinas de servicio de interrupción. Evite retardos bloqueantes y cálculos largos dentro de la ISR.

## Code Description
Descripción del código

### Main Compiler Header
Archivo de cabecera principal del compilador

`#include <xc.h>` proporciona las definiciones de registros y bits específicas del dispositivo utilizadas por el compilador XC8.

### Interrupt Header
Archivo de cabecera de interrupciones

```c
#include <avr/interrupt.h>
```

Este archivo de cabecera proporciona la macro `ISR()` y la función `sei()`.

### CPU Clock Definition
Definición de la frecuencia de la CPU

```c
#define F_CPU 3333333UL
```

`F_CPU` especifica la frecuencia de la CPU utilizada para calcular el período del temporizador. Con la configuración de reloj de fábrica, este valor es `3333333UL`, aproximadamente 3,333 MHz.

Esta definición no configura el reloj de hardware.

### Timer Configuration Parameters
Parámetros de configuración del temporizador

```c
#define TCA_PRESCALER 1024UL
#define TCA_PERIOD_US 500000UL
```

`TCA_PRESCALER` es el valor numérico del divisor de reloj seleccionado para TCA0.

`TCA_PERIOD_US` es el período de interrupción solicitado en microsegundos.

La sección **Parámetros del temporizador definidos por el usuario**, situada más arriba, contiene información más detallada.

### Timer Period Register Calculation
Cálculo del registro de período del temporizador

```c
#define TCA_PER_VALUE     ((uint16_t)(((F_CPU / TCA_PRESCALER) * TCA_PERIOD_US) / 1000000UL - 1UL))
```

Esta expresión calcula el valor que se escribe en el registro de período de 16 bits de TCA0.

El resultado debe caber en el registro `PER` de 16 bits.

La aritmética entera cuantiza el resultado a un número entero de cuentas del temporizador, por lo que el período real puede diferir ligeramente del período solicitado.

Con los valores de este miniproyecto, el cálculo es válido. Al cambiar sustancialmente los parámetros, compruebe también que la aritmética intermedia permanezca dentro de su rango admitido.

### TCA0 Initialization
Inicialización de TCA0

`Init_TCA()`:

- selecciona el modo normal de conteo;
- habilita la interrupción de desbordamiento de TCA0;
- carga el valor calculado del período;
- selecciona la división de reloj por 1024;
- inicia TCA0.

La definición numérica `TCA_PRESCALER` y la constante de selección del reloj de hardware deben representar el mismo divisor.

### TCA0 Overflow Interrupt
Interrupción de desbordamiento de TCA0

```c
ISR(TCA0_OVF_vect)
```

Coloque aquí código breve que deba ejecutarse cada vez que se produzca la interrupción del temporizador.

En este miniproyecto, la única acción de aplicación realizada dentro de la ISR es conmutar la salida PB1.

#### TCA0 Overflow Interrupt Flag Reset
Restablecimiento de la bandera de interrupción de desbordamiento de TCA0

La bandera de interrupción de desbordamiento no se borra automáticamente. Debe borrarse dentro de la ISR escribiendo `1` en el bit de la bandera. De lo contrario, la solicitud de interrupción puede permanecer activa y provocar una nueva entrada inmediata en la ISR.

```c
TCA0.SINGLE.INTFLAGS = TCA_SINGLE_OVF_bm;
```

Preste especial atención a esta operación: un bit de bandera establecido en `1` se borra escribiendo `1` en ese bit.

### The Entry Point
Punto de entrada

`int main(void)` es el punto de entrada del programa.

### PB1 Output Initialization
Inicialización de la salida PB1

```c
PORTB.OUTCLR = PIN1_bm;
PORTB.DIRSET = PIN1_bm;
```

El nivel de salida se establece en bajo antes de habilitar PB1 como salida. Esto proporciona un estado inicial definido.

### Timer Initialization
Inicialización del temporizador

PB1 se configura antes de iniciar el temporizador porque PB1 se conmuta dentro de la ISR del temporizador.

```c
Init_TCA();
```

Después de que `Init_TCA()` termina, TCA0 ya está funcionando, pero su interrupción no puede atenderse hasta que se habiliten globalmente las interrupciones.

### Global Interrupt Initialization
Habilitación global de interrupciones

Las interrupciones globales deben habilitarse para que se pueda atender la interrupción de TCA0.

```c
sei();
```

Llame a `sei()` después de completar toda la inicialización que habilita fuentes de interrupción.

### Main Infinite Loop
Bucle principal infinito

El bucle `while (1)` mantiene el programa en ejecución continua.

En este miniproyecto, el bucle está vacío porque la acción periódica sobre el LED se realiza en la ISR del temporizador.

Se puede colocar código de aplicación en el bucle, incluso código que bloquee el bucle principal. Las interrupciones habilitadas aún pueden interrumpir ese código, siempre que este no deshabilite las interrupciones globales.

El código del bucle principal y la ISR no se ejecutan simultáneamente en la CPU. Cuando ocurre una interrupción, la CPU suspende temporalmente el código del bucle principal, ejecuta la ISR y después reanuda el código interrumpido.

### Main-Loop Application Code
Código de aplicación del bucle principal

El código de la aplicación puede colocarse dentro del bucle principal.

La ISR del temporizador interrumpe temporalmente el código del bucle principal aproximadamente cada 0,5 segundos y después regresa a él. Normalmente, esta interrupción dura muy poco tiempo en comparación con el intervalo del temporizador.

### This Code Is Never Reached
Este código nunca se alcanza

`return 0;` no se alcanza durante el funcionamiento normal porque la ejecución permanece dentro del bucle infinito.

### Application Scope
Ámbito de aplicación

Este miniproyecto está destinado a microcontroladores AVR con un periférico TCA0 y una interfaz de registros compatibles.

### Tested Hardware
Hardware probado

- `ATtiny1624`, SOIC-14
