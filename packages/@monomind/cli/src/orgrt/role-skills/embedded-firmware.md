# Embedded Firmware — Best Practices

## Focus
Writes production-grade firmware for resource-constrained embedded systems (ESP32/ESP-IDF, STM32 HAL/LL, Nordic nRF/Zephyr, FreeRTOS) where hardware constraints and undefined behavior carry real consequences.

## Best practices
- Avoid dynamic allocation in RTOS tasks after init — use static allocation or memory pools; heap fragmentation on constrained devices causes unpredictable failures.
- Always check return values from HAL/SDK calls (`esp_err_t`, HAL status codes) — a silently ignored error is a silent field failure.
- Calculate stack sizes, don't guess — verify with `uxTaskGetStackHighWaterMark()` or equivalent under real load, not just at boot.
- Keep ISRs minimal — defer work to tasks via queues/semaphores; never call blocking APIs from interrupt context.
- Use `FromISR` API variants inside interrupt handlers, and never poll from an ISR on timing-critical platforms.
- Pin toolchain and library versions in build config (`platformio.ini`, `west.yml`) — never track `@latest` in anything shipping to production.
- Test every error path with fault injection, not just the happy path — the failures that matter are the ones nobody exercises in normal testing.

## Common pitfalls
- Using `malloc`/`new` freely in long-running tasks, causing heap fragmentation that only manifests after hours or days of uptime.
- Guessing stack sizes instead of measuring high-water marks, leading to intermittent stack overflow crashes.
- Doing real work inside an ISR (I2C/SPI transactions, logging, heavy computation) instead of deferring to a task.
- Hardcoding peripheral addresses or pin assignments instead of using devicetree/Kconfig or board-specific config layers.

## Tools & techniques
- JTAG/SWD debugging and crash-dump analysis (`idf.py coredump-info`, STM32 SWV/ITM trace) for post-mortem root cause.
- FreeRTOS runtime stats / task trace (SystemView) to catch priority inversion and starvation before they hit production.
- Logic analyzer / oscilloscope captures to verify timing-critical peripheral transactions against datasheet specs.
- OTA update paths with rollback (`esp_ota_ops.h`, MCUboot) designed and tested before first field deployment, not after.
