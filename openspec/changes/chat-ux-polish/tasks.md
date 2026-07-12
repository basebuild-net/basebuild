# Tasks: Chat UX Polish

## 1. Scroll-to-Bottom Button

- [ ] 1.1 Add `isScrolledUp` state and scroll listener to ChatPanel (reuse 80px threshold)
- [ ] 1.2 Add floating scroll-to-bottom button in transcript area with `title=` tooltip
- [ ] 1.3 Add `.chat-scroll-bottom-btn` CSS class in globals.css (0px radius, floating, bottom-right)
- [ ] 1.4 Test: button appears when scrolled up, disappears at bottom, click scrolls to bottom

## 2. Reasoning Blocks Default Expanded

- [ ] 2.1 Change `useState(false)` to `useState(true)` in ThinkingBlock component
- [ ] 2.2 Test: reasoning block is visible by default without click

## 3. In-Conversation Search

- [ ] 3.1 Add `showSearch` state and `Ctrl+F` / `Cmd+F` keydown handler
- [ ] 3.2 Add search bar UI at top of transcript with input, match count, prev/next, close
- [ ] 3.3 Add text highlighting logic: wrap matches in `<mark>` elements, debounce 150ms, cap 500 matches
- [ ] 3.4 Add prev/next navigation: Enter = next, Shift+Enter = prev, scroll to active match
- [ ] 3.5 Add Escape to close search, clear highlights, return focus to chat input
- [ ] 3.6 Add `.chat-search-bar`, `.chat-search-input`, `.chat-search-count`, `.chat-search-btn`, `mark.chat-search-highlight`, `mark.chat-search-highlight-active` CSS classes
- [ ] 3.7 Test: Ctrl+F opens search, typing highlights, next/prev navigates, Escape closes

## 4. Copy Conversation

- [ ] 4.1 Add `handleCopyConversation` function: iterate buildChatTimeline output, format as markdown
- [ ] 4.2 Add "Copy conversation" button in chat header with `title=` tooltip
- [ ] 4.3 Disable button when no messages exist
- [ ] 4.4 Show toast on success/failure
- [ ] 4.5 Test: copy produces markdown, disabled when empty

## 5. History Toggle Wiring

- [ ] 5.1 Wire ChatHeader `onToggleHistory` to open HistoryDrawer (currently `() => {}`)
- [ ] 5.2 Test: clicking history toggle opens drawer

## 6. Accessibility Fixes

- [ ] 6.1 Add `aria-expanded` to tool card header buttons
- [ ] 6.2 Add `aria-label` to chat message rows (role + content snippet)
- [ ] 6.3 Add `aria-live` region for streaming/tool-running status
- [ ] 6.4 Add `aria-label` to chat input textarea
- [ ] 6.5 Add `aria-pressed` to agent mode pill toggle in ChatHeader

## 7. Textarea Inline Style Fix

- [ ] 7.1 Replace `el.style.height = 'auto'` / `el.style.height = ...` with CSS custom property or data attribute approach
- [ ] 7.2 Add `.chat-input-textarea` class with `field-sizing: content` or JS-driven `--chat-input-height` custom property

## 8. Tests & Verification

- [ ] 8.1 Add e2e tests for all new features in chat-edge-cases.spec.ts
- [ ] 8.2 Run `tsc --noEmit` clean
- [ ] 8.3 Run full e2e suite with `--workers=2` and confirm all green
