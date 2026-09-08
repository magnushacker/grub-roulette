// Shared three-state cuisine chip widget (neutral -> prefer -> avoid -> ...),
// used by both the dashboard's quick picker and the account modal's full
// cuisine history editor. Doesn't own any state itself -- callers supply
// getters/setters so each page can keep state however suits it.

const CUISINE_STATES = ["neutral", "prefer", "avoid"];
const CUISINE_STATE_MARK = { neutral: "", prefer: "✓", avoid: "✗" };
const CUISINE_STATE_DESCRIPTION = { neutral: "no preference", prefer: "preferred", avoid: "don't suggest" };

function paintCuisineChip(btn, label, state) {
    btn.dataset.state = state;
    btn.textContent = "";
    if (CUISINE_STATE_MARK[state]) {
        const mark = document.createElement("span");
        mark.className = "chip-mark";
        mark.setAttribute("aria-hidden", "true");
        mark.textContent = CUISINE_STATE_MARK[state];
        btn.appendChild(mark);
    }
    btn.appendChild(document.createTextNode(label));
    btn.setAttribute("aria-label", `${label}: ${CUISINE_STATE_DESCRIPTION[state]}`);
}

// options.getState(cuisine)     -> your own actual state; the base a click cycles from
// options.displayState(cuisine) -> what to paint (may differ from getState -- e.g. the
//                                   dashboard falling back to a default when you haven't
//                                   picked one yourself)
// options.setState(cuisine, next) -> persist your own new pick
function makeCuisineChip(cuisine, options) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    const label = cuisine.replace(/_/g, " ");
    const repaint = () => paintCuisineChip(btn, label, options.displayState(cuisine));
    btn.addEventListener("click", (e) => {
        const step = e.shiftKey ? -1 : 1;
        const current = CUISINE_STATES.indexOf(options.getState(cuisine));
        const next = (current + step + CUISINE_STATES.length) % CUISINE_STATES.length;
        options.setState(cuisine, CUISINE_STATES[next]);
        repaint();
    });
    repaint();
    return btn;
}
