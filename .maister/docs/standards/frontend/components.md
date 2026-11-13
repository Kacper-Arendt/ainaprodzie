## Components

What each shared component looks like and how its states are drawn is in [DESIGN.md › Components](../../../../DESIGN.md#components); these rules are about how components are built.

### Single Responsibility
Each component should do one thing well.

### Reuse Before Building
Before building a control or a surface, look for its primitive in `components/ui` ([design-system.md](design-system.md)) and extend it with a prop when a feature needs a variant. Don't add configurability no current caller uses.

### One Owner per Ticket Fact
A ticket fact that appears in more than one place (status, priority, the response clock with its SLA state, waiting time) is rendered by the one component or formatter that owns it, such as the ticket list's Response cell. A new place imports that owner and does not format the fact again, so two views of one ticket never show different figures or words for it. A place that looks like another view, such as a short list of tickets shaped like the list's rows, shows the same facts as that view; any other fact it shows carries a visible label. If the owner does not fit the new layout, add a prop to it; do not copy its logic.

### Composability
Build complex UIs by combining smaller components rather than creating monoliths.

### Clear Interface
Define explicit, typed props with sensible defaults; a prop's name says what it does, and a doc comment explains only what the name and type cannot (why a variant exists, which surface it is for).

### Encapsulation
Keep implementation details private; expose only what's necessary.

### Consistent Naming
Use descriptive names that indicate purpose and follow team conventions.

### Local State
Keep state as close to where it's used as possible; lift only when needed.

### Minimal Props
If a component needs many props, consider composition or splitting it.
