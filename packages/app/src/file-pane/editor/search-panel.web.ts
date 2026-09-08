import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  selectMatches,
  setSearchQuery,
} from "@codemirror/search";
import type { EditorView, Panel, ViewUpdate } from "@codemirror/view";

const MAX_COUNTED_MATCHES = 999;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

const ICON_PATHS = {
  chevron: "M6 9l6 6 6-6",
  previous: "M12 19V5m-7 7 7-7 7 7",
  next: "M12 5v14m7-7-7 7-7-7",
  selectAll: "M4 6h16M4 12h16M4 18h11",
  close: "M6 6l12 12M18 6 6 18",
  replace: "M4 7h11m-3-3 3 3-3 3m8 7H9m3-3-3 3 3 3",
  replaceAll: "M5 6h10m-3-3 3 3-3 3m7 8H9m3-3-3 3 3 3M3 3v18M21 3v18",
} as const;

type IconName = keyof typeof ICON_PATHS;

function createIcon(document: Document, name: IconName): SVGSVGElement {
  const icon = document.createElementNS(SVG_NAMESPACE, "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NAMESPACE, "path");
  path.setAttribute("d", ICON_PATHS[name]);
  icon.appendChild(path);
  return icon;
}

function createIconButton(input: {
  document: Document;
  className?: string;
  label: string;
  icon: IconName;
  onClick: () => void;
}): HTMLButtonElement {
  const button = input.document.createElement("button");
  button.type = "button";
  button.className = ["omp-editor-search-button", input.className].filter(Boolean).join(" ");
  button.setAttribute("aria-label", input.label);
  button.title = input.label;
  button.appendChild(createIcon(input.document, input.icon));
  button.addEventListener("click", input.onClick);
  return button;
}

function createTextToggle(input: {
  document: Document;
  className?: string;
  label: string;
  text: string;
  onClick: () => void;
}): HTMLButtonElement {
  const button = input.document.createElement("button");
  button.type = "button";
  button.className = ["omp-editor-search-button", "omp-editor-search-option", input.className]
    .filter(Boolean)
    .join(" ");
  button.setAttribute("aria-label", input.label);
  button.title = input.label;
  button.textContent = input.text;
  button.addEventListener("click", input.onClick);
  return button;
}

class CursorSearchPanel implements Panel {
  readonly dom: HTMLElement;
  readonly top = true;

  private readonly searchInput: HTMLInputElement;
  private readonly replaceInput: HTMLInputElement;
  private readonly resultText: HTMLSpanElement;
  private readonly replaceRow: HTMLDivElement;
  private readonly caseButton: HTMLButtonElement;
  private readonly wordButton: HTMLButtonElement;
  private readonly regexpButton: HTMLButtonElement;
  private query: SearchQuery;
  private replaceExpanded = true;

  constructor(private readonly view: EditorView) {
    const document = view.dom.ownerDocument;
    this.query = getSearchQuery(view.state);

    this.dom = document.createElement("form");
    this.dom.className = "omp-editor-search";
    this.dom.dataset.editorSearchPanel = "true";
    this.dom.dataset.replaceExpanded = "true";
    this.dom.setAttribute("role", "search");
    this.dom.addEventListener("submit", (event) => event.preventDefault());
    this.dom.addEventListener("keydown", (event) => this.handleKeyDown(event));

    const queryRow = document.createElement("div");
    queryRow.className = "omp-editor-search-row";

    const expandButton = createIconButton({
      document,
      className: "omp-editor-search-expand",
      label: "Toggle replace",
      icon: "chevron",
      onClick: () => this.toggleReplace(),
    });
    expandButton.setAttribute("aria-expanded", "true");

    const searchField = document.createElement("div");
    searchField.className = "omp-editor-search-field";
    this.searchInput = document.createElement("input");
    this.searchInput.type = "text";
    this.searchInput.name = "search";
    this.searchInput.value = this.query.search;
    this.searchInput.placeholder = "Find";
    this.searchInput.autocomplete = "off";
    this.searchInput.spellcheck = false;
    this.searchInput.setAttribute("aria-label", "Find");
    this.searchInput.setAttribute("main-field", "true");
    this.searchInput.addEventListener("input", () => this.commitQuery());

    this.caseButton = createTextToggle({
      document,
      label: "Match case",
      text: "Aa",
      onClick: () => this.toggleQueryOption("caseSensitive"),
    });
    this.wordButton = createTextToggle({
      document,
      className: "omp-editor-search-whole-word",
      label: "Match whole word",
      text: "ab",
      onClick: () => this.toggleQueryOption("wholeWord"),
    });
    this.regexpButton = createTextToggle({
      document,
      label: "Use regular expression",
      text: ".*",
      onClick: () => this.toggleQueryOption("regexp"),
    });
    searchField.append(this.searchInput, this.caseButton, this.wordButton, this.regexpButton);

    this.resultText = document.createElement("span");
    this.resultText.className = "omp-editor-search-result";
    this.resultText.setAttribute("aria-live", "polite");

    const queryActions = document.createElement("div");
    queryActions.className = "omp-editor-search-actions";
    queryActions.append(
      createIconButton({
        document,
        label: "Previous match",
        icon: "previous",
        onClick: () => findPrevious(view),
      }),
      createIconButton({
        document,
        label: "Next match",
        icon: "next",
        onClick: () => findNext(view),
      }),
      createIconButton({
        document,
        label: "Select all matches",
        icon: "selectAll",
        onClick: () => selectMatches(view),
      }),
      createIconButton({
        document,
        label: "Close search",
        icon: "close",
        onClick: () => closeSearchPanel(view),
      }),
    );
    queryRow.append(expandButton, searchField, this.resultText, queryActions);

    this.replaceRow = document.createElement("div");
    this.replaceRow.className = "omp-editor-search-row omp-editor-search-replace-row";
    const replaceSpacer = document.createElement("span");
    replaceSpacer.setAttribute("aria-hidden", "true");
    const replaceField = document.createElement("div");
    replaceField.className = "omp-editor-search-field";
    this.replaceInput = document.createElement("input");
    this.replaceInput.type = "text";
    this.replaceInput.name = "replace";
    this.replaceInput.value = this.query.replace;
    this.replaceInput.placeholder = "Replace";
    this.replaceInput.autocomplete = "off";
    this.replaceInput.spellcheck = false;
    this.replaceInput.setAttribute("aria-label", "Replace");
    this.replaceInput.addEventListener("input", () => this.commitQuery());
    replaceField.appendChild(this.replaceInput);

    const replaceActions = document.createElement("div");
    replaceActions.className = "omp-editor-search-actions omp-editor-search-replace-actions";
    replaceActions.append(
      createIconButton({
        document,
        label: "Replace next match",
        icon: "replace",
        onClick: () => replaceNext(view),
      }),
      createIconButton({
        document,
        label: "Replace all matches",
        icon: "replaceAll",
        onClick: () => replaceAll(view),
      }),
    );
    this.replaceRow.append(replaceSpacer, replaceField, replaceActions);
    this.dom.append(queryRow, this.replaceRow);
    this.syncQueryControls();
    this.updateResultText();
  }

  mount(): void {
    this.searchInput.select();
  }

  update(update: ViewUpdate): void {
    const nextQuery = getSearchQuery(update.state);
    if (!nextQuery.eq(this.query)) {
      this.query = nextQuery;
      this.searchInput.value = nextQuery.search;
      this.replaceInput.value = nextQuery.replace;
      this.syncQueryControls();
    }
    if (
      update.docChanged ||
      update.selectionSet ||
      !nextQuery.eq(getSearchQuery(update.startState))
    ) {
      this.updateResultText();
    }
  }

  private commitQuery(): void {
    const nextQuery = new SearchQuery({
      search: this.searchInput.value,
      replace: this.replaceInput.value,
      caseSensitive: this.query.caseSensitive,
      wholeWord: this.query.wholeWord,
      regexp: this.query.regexp,
      literal: this.query.literal,
      test: this.query.test,
    });
    if (nextQuery.eq(this.query)) return;
    this.query = nextQuery;
    this.view.dispatch({ effects: setSearchQuery.of(nextQuery) });
  }

  private toggleQueryOption(option: "caseSensitive" | "wholeWord" | "regexp"): void {
    const nextQuery = new SearchQuery({
      search: this.searchInput.value,
      replace: this.replaceInput.value,
      caseSensitive:
        option === "caseSensitive" ? !this.query.caseSensitive : this.query.caseSensitive,
      wholeWord: option === "wholeWord" ? !this.query.wholeWord : this.query.wholeWord,
      regexp: option === "regexp" ? !this.query.regexp : this.query.regexp,
      literal: this.query.literal,
      test: this.query.test,
    });
    this.query = nextQuery;
    this.syncQueryControls();
    this.view.dispatch({ effects: setSearchQuery.of(nextQuery) });
    this.searchInput.focus();
  }

  private syncQueryControls(): void {
    this.setToggleState(this.caseButton, this.query.caseSensitive);
    this.setToggleState(this.wordButton, this.query.wholeWord);
    this.setToggleState(this.regexpButton, this.query.regexp);
  }

  private setToggleState(button: HTMLButtonElement, active: boolean): void {
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }

  private toggleReplace(): void {
    this.replaceExpanded = !this.replaceExpanded;
    this.replaceRow.hidden = !this.replaceExpanded;
    this.dom.dataset.replaceExpanded = String(this.replaceExpanded);
    const button = this.dom.querySelector<HTMLButtonElement>(".omp-editor-search-expand");
    button?.setAttribute("aria-expanded", String(this.replaceExpanded));
  }

  private handleKeyDown(event: KeyboardEvent): void {
    const key = event.key.toLowerCase();
    const mod = event.metaKey || event.ctrlKey;
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearchPanel(this.view);
      return;
    }
    if (mod && key === "f" && !event.altKey) {
      event.preventDefault();
      this.searchInput.focus();
      this.searchInput.select();
      return;
    }
    if (event.key === "F3" || (mod && key === "g" && !event.altKey)) {
      event.preventDefault();
      (event.shiftKey ? findPrevious : findNext)(this.view);
      return;
    }
    if (event.key !== "Enter") return;
    if (event.target === this.searchInput) {
      event.preventDefault();
      (event.shiftKey ? findPrevious : findNext)(this.view);
    } else if (event.target === this.replaceInput) {
      event.preventDefault();
      replaceNext(this.view);
    }
  }

  private updateResultText(): void {
    if (!this.query.search) {
      this.resultText.textContent = "";
      return;
    }
    if (!this.query.valid) {
      this.resultText.textContent = "Invalid pattern";
      return;
    }

    const selection = this.view.state.selection.main;
    const cursor = this.query.getCursor(this.view.state);
    let total = 0;
    let selectedIndex = 0;
    let nextIndex = 0;
    let truncated = false;
    while (true) {
      const entry = cursor.next();
      if (entry.done) break;
      total += 1;
      const match = entry.value;
      if (match.from === selection.from && match.to === selection.to) selectedIndex = total;
      if (nextIndex === 0 && match.from >= selection.to) nextIndex = total;
      if (total >= MAX_COUNTED_MATCHES) {
        truncated = !cursor.next().done;
        break;
      }
    }

    if (truncated) {
      this.resultText.textContent = `${MAX_COUNTED_MATCHES}+ results`;
    } else if (total === 0) {
      this.resultText.textContent = "No results";
    } else {
      this.resultText.textContent = `${selectedIndex || nextIndex || 1} of ${total}`;
    }
  }
}

export function createCursorSearchPanel(view: EditorView): Panel {
  return new CursorSearchPanel(view);
}
