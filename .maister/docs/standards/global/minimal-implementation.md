## Minimal Implementation

### Build Only What Is Called
Write only the code a current caller uses: no empty methods, placeholder interfaces, or factories, strategies and adapters "for future extensibility", and no option no caller sets. Before finishing a task, check that every new method, type and prop has a caller or makes the code easier to read.

### Delete What the Work Left Behind
Helpers, logging and files created while exploring go before the commit. Unused code is debt: it confuses readers and has to be maintained.
