# ATtiny162x GPIO programming methodology

## GPIO scope and source selection

Apply this methodology to ATtiny1624, ATtiny1626 and ATtiny1627. It supports the reviewed GPIO recipe; descriptions of analog preparation, EVSYS, sleep and advanced peripheral routing explain integration constraints and do not authorize unsupported generation modes. Resolve implementation support through the active resource contract and approved recipes before generating C.

Begin with the exact MCU, package, schematic and requested behavior. Map the physical package pin to `Pxn`, then check pin ownership, peripheral routes and special functions. A register name or `PINn_bm` in a header does not prove that a pin is bonded out or free. Keep PA0 reserved for UPDI in the current pilot. Use canonical package mappings and the DS80000902F corrections, rather than copying the colleague's older pin-multiplexing table.

Read only relevant local evidence: package data for pin allocation; PORT pages 147-170 of DS40002234B for pin behavior; the assigned peripheral chapter for override rules; DFP and installed XC8 headers for symbols; electrical specifications plus errata for electrical claims. Block models explain signal paths, but do not establish register values, timing limits or a peripheral's exact override conditions. Prefer existing local references; seek additional primary evidence only for an unresolved, relevant gap.

The colleague's TB3229 examples illustrate techniques on ATmega4809. Transfer the method after checking the ATtiny162x device; never copy its board pins, clock setup or assumptions unchanged. This curated text retains useful method while keeping the canonical DFP and indexed datasheet as the register reference.

## GPIO output state, polarity and reset

`PORTx.DIR` controls the output driver; `PORTx.OUT` stores its requested value. The physical output also depends on inversion and peripheral override. Determine the load's active polarity and the required safe state before enabling the driver. Write the safe latch state through `OUTSET` or `OUTCLR`, then enable the selected driver with `DIRSET`. An active-low load is inactive when the physical pin is high.

Example: PB1 drives an active-low LED, inversion is off, and no peripheral owns PB1. Include `<xc.h>` in the complete XC8 program. Map PB1 to the selected package before using this fragment.

```c
static void led_init(void)
{
    PORTB.OUTSET = PIN1_bm;
    PORTB.DIRSET = PIN1_bm;
}

static void led_on(void)  { PORTB.OUTCLR = PIN1_bm; }
static void led_off(void) { PORTB.OUTSET = PIN1_bm; }
```

After reset, ordinary GPIO output drivers are tri-stated and digital input buffers are enabled; special-function pins may differ. Firmware establishes its safe state only when initialization executes. A requirement to hold the load inactive during reset, startup or programming needs a suitable circuit, such as an external pull resistor or driver. Do not claim the two C writes guarantee reset-time behavior.

A boot-only initializer may omit a write whose required reset state is verified and still guaranteed. A reusable initializer must account for previous inversion, latch values, routes and driver state. If changing inversion or ownership could drive an unwanted level, disable the driver or otherwise establish a safe transition before reconfiguration. Do not reset unrelated pins or peripherals merely to simplify one initializer.

Use explicit `OUTSET`/`OUTCLR` when the resulting state must be known. Use `OUTTGL` for an intentional toggle, such as alternating a known LED state. A toggle every 125 ms yields a nominal 250 ms full on/off cycle; the actual time source and first interval must be documented separately.

## GPIO mask writes and VPORT timing

For selected direction bits use direct writes to `DIRSET`, `DIRCLR` or, when a direction toggle is intentional, `DIRTGL`. For selected output bits use direct writes to `OUTSET`, `OUTCLR` or `OUTTGL`. A written one acts on that bit; zero leaves it unchanged. Several masks may be combined in one write. Reading a direction alias returns `DIR`; reading an output alias returns `OUT`.

Avoid `PORTx.OUT |= mask` and whole-port read-modify-write when a hardware alias expresses the operation. Another execution context can change unrelated bits between the read and write. Direct replacement of `DIR` or `OUT` is appropriate only when the complete port value is intentionally owned and assigned. Mask aliases avoid the whole-byte race but do not resolve two modules issuing contradictory commands to the same pin.

`VPORTx` maps only `DIR`, `OUT`, `IN` and `INTFLAGS` into I/O space. It has no `PINnCTRL`, `PORTCTRL` or set/clear/toggle aliases. Selected constant-bit C expressions can compile into suitable bit instructions, but a C statement is not proof of a single-cycle operation or atomicity. Use VPORT only when a timing requirement justifies it, then inspect the actual optimized machine instructions for the selected core and compiler.

Writing one to `PORTx.IN` or `VPORTx.IN` toggles the corresponding `OUT` latch. It does not assign an input value. Prefer `OUTTGL` for clarity unless an intentional, verified VPORT instruction is needed. Never use a read-modify-write expression on `IN` to simulate an input.

## GPIO input buffer, pull-up and field ownership

`PORTx.IN` is the sampled pin value synchronized to `CLK_PER`; it is not a copy of the output latch. An output pin can normally be sampled too, provided its digital input buffer remains enabled. When `CLK_PER` stops, input synchronization stops.

For a digital input, disable its output driver with `DIRCLR` and deliberately configure `PINnCTRL`. For a button connecting the pin to GND when pressed, enable a pull-up if the board does not already establish an incompatible bias. With inversion off, zero means pressed and one means released.

```c
PORTA.DIRCLR = PIN6_bm;
PORTA.PIN6CTRL = PORT_PULLUPEN_bm | PORT_ISC_INTDISABLE_gc;

uint8_t pressed = (PORTA.IN & PIN6_bm) == 0u;
```

This fragment assumes exclusive configuration ownership of PA6 and requires `<stdint.h>` for `uint8_t`. A full `PIN6CTRL` assignment intentionally replaces inversion, pull-up and sense fields. When changing only the sense field of an already configured pin, preserve other required fields:

```c
PORTA.PIN6CTRL =
    (PORTA.PIN6CTRL & (uint8_t)~PORT_ISC_gm) | PORT_ISC_FALLING_gc;
```

That is a software read-modify-write on one pin-control register, so concurrent access still needs an ownership or exclusion rule. Do not assign reserved bits or reserved sense values.

`INTDISABLE` disables the pin interrupt but keeps the input buffer enabled. `INPUT_DISABLE` disables both, stops fresh `IN` updates, and makes the corresponding PORT event output zero. Do not choose it for a pin read by software, used for a pin interrupt, used as a digital event generator, or assigned to a peripheral requiring that buffer. Applying it to a pure output is an optional power measure; it is not necessary for output operation or safe initial level and should not be added mechanically to every LED example.

`PULLUPEN` enables the pull-up when the pin is input-only; the pull-up is disconnected while configured as output. There is no internal pull-down in this PORT interface. The corrected pull-up resistance is 20/35/60 kOhm minimum/typical/maximum (DS80000902F page 10), not a precision timing resistor.

## GPIO unused pins, analog preparation and electrical boundaries

Do not touch every unassigned pin automatically. First confirm that it is truly unconnected, not a test point or externally driven signal, and not used for UPDI, RESET or another peripheral. For a truly unconnected pin, the colleague's optional preference is input-only plus `PULLUPEN` and `INPUT_DISABLE`: the digital buffer is disabled and the pull-up establishes a physical high after initialization. An external pull-down is incompatible with that pull-up preference. If the level matters during reset, internal pull-up setup is insufficient.

For a selected analog input, ordinary pin preparation disables the output driver, disables the pull-up, and normally disables the digital input buffer after checking the analog pin mapping and peripheral requirements. These PORT operations do not configure the ADC, AC, reference or analog acquisition. They do not expand the approved generation scope to those peripherals.

Check voltage levels, output current, aggregate port/device current, current-limiting resistor and pull-up characteristics against the relevant electrical evidence and actual circuit. PORT register descriptions alone do not establish them. `PORTx.PORTCTRL.SRL` applies slew-rate limiting to the whole port; changing it for one pin can affect other pins. Numerical slew-rate or low-power guarantees require electrical and silicon-specific review.

## GPIO inversion and peripheral integration

`PINnCTRL.INVEN` changes both input and output interpretation. Changing inversion can itself create an edge visible to interrupt/event logic or a connected peripheral. Do not silently change it while those consumers are active. The safe output sequence must use the required physical polarity, not only the logical latch value.

For a routed peripheral, check the selected package, primary/alternate route, PORTMUX value, and exact direction/output/input-buffer override behavior in that peripheral's documentation. Peripheral control can override some aspects of GPIO while leaving others under PORT control. The block-model override arrows do not mean that enabling a peripheral always controls every pin property. Unoverridden pins remain GPIO.

PORT's digital event generator carries the pin level asynchronously while its input buffer is enabled. This path differs from the synchronized `IN` read. PORT has no event inputs; routing and event consumers belong to EVSYS and require separately supported configuration.

## GPIO interrupts, shared flags and reconfiguration

Choose the sense condition required by the application: `BOTHEDGES`, `RISING`, `FALLING` or low `LEVEL`. `INTDISABLE` and `INPUT_DISABLE` are not equivalent ways to retain digital reading. There is no separate high-level sense enum; any use of inversion to change logical polarity must account for its input/output effects and induced edge.

A PORT vector may serve several pins. Read `PORTx.INTFLAGS` when several enabled pins can cause that vector, dispatch all owned pending sources, and acknowledge only the sources actually handled. Directly write each serviced W1C mask, for example `PORTA.INTFLAGS = PIN6_bm;`. Do not use `|=`, `&=` or an unfiltered snapshot write merely to dismiss all flags. A snapshot may be written back only if every included flag was intentionally serviced.

When exactly one source is enabled for a vector and that remains a whole-program invariant, its handler may acknowledge and service that known source without testing its flag first. Adding another source invalidates this simplification. An asserted low-level condition can continue requesting service; clearing a flag is not a substitute for handling the underlying condition.

Prepare shared software state and the peripheral before opening global delivery in `main()`. Do not hide `sei()` inside a GPIO or button helper. During reconfiguration, quiesce the owned source as needed, choose the desired sense and inversion deliberately, and establish a stale-event policy. Changing `ISC` during synchronization can lose a pending request; disabling and re-enabling sensing can reveal a previously synchronized request; changing `INVEN` and `ISC` together may suppress the inversion-induced interrupt. Do not assume arbitrary reconfiguration is an event-preserving operation.

## GPIO button interpretation and debounce

An edge ISR should acknowledge the source and publish a small pending indication. It should not infer a stable button press from a single bouncing edge. A Boolean indication coalesces edges; it does not count them. Consume and clear it atomically in main-line code as described in the interrupt methodology.

For short/long press recognition, implement the state sequence rather than copying an example delay:

1. Establish a confirmed released state.
2. Accept press only after a stable low interval selected for the actual switch.
3. Record press time using a known time base.
4. Accept release only after a stable high interval.
5. Compare elapsed time with the requested threshold and act once per accepted press/release cycle.

Choose how a button already held at boot should behave. After an interrupt, sample and debounce the current level instead of relying on an assumed edge direction. Define timer resolution, elapsed-time wrap handling and responsiveness for the application. Ten milliseconds in a demonstration is not a universal bounce specification. Use a nonblocking state machine when blocking delays would prevent other required work; a simple blocking demonstration still needs known clock/timing assumptions.

## GPIO asynchronous wake-up and verification boundary

For ATtiny162x, the pin table identifies bonded `Px2` and `Px6` pins as fully asynchronous. Check actual pin availability and routing before selecting them. With `CLK_PER` running, fully and partially asynchronous pins support all enabled interrupt sense configurations. With the clock stopped, partially asynchronous pins support only `BOTHEDGES` or `LEVEL`, and the required level must remain until `CLK_PER` restarts; otherwise wake-up may occur without an interrupt.

The datasheet's table 17-3 gives partially asynchronous pins a minimum pulse width of one `CLK_PER` cycle when running and three cycles of interrupt dead-time. Its fully asynchronous timing cell spans these properties and states less than one `CLK_PER` cycle. Do not convert that relative statement into a zero-width pulse guarantee or invent a nanosecond minimum. Check electrical timing when an actual narrow pulse matters.

Sleep generation remains outside the reviewed recipe scope. A future implementation must verify the selected sleep mode, wake source, pulse/level duration, pending-event handoff and a race-free test-and-sleep sequence. The pattern `if (!pending) sleep_mode();` can miss the event between test and sleep. Merely selecting PA6 with both-edge sensing does not validate a complete sleep application.

When the CPU is halted by a debugger, PORT continues operating; CPU-serviced events can be lost or coalesced. Verify on the exact MCU/package with the actual XC8/DFP build. Inspect assembly for timing claims, and test polarity, startup/reset state, debounce, event handling and wake-up on hardware when those properties are claimed. Compilation proves neither wiring nor physical operation.

Primary evidence: DS40002234B pages 18, 147-170; DS80000902F pages 9-10; pinned DFP PORT/VPORT definitions. Grouped colleague provenance and explicit adaptations are recorded in `provenance/adoption-gpio-interrupts.json`.
