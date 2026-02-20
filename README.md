# GPT Cleaner

A Chrome extension that optimizes ChatGPT's performance during long conversations by virtualizing the message DOM.

When a ChatGPT conversation gets very long (100+ messages), the browser starts to slow down due to the sheer number of complex DOM elements (code blocks, markdown, SVGs) it has to render and layout.

**GPT Cleaner** fixes this by:

1. Keeping only the most recent N messages (default 10) in the DOM
2. Detaching older messages and storing them in memory
3. Lazily restoring older messages as you scroll up, 10 at a time

This dramatically reduces RAM usage, prevents layout jumping, and keeps the page feeling snappy no matter how long the conversation gets.

## Installation

Since the extension is currently in development/unpacked form:

1. Download or clone this repository
2. Open Google Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** in the top right corner
4. Click **Load unpacked** in the top left corner
5. Select the `gpt-cleaner` folder
6. Open ChatGPT and the extension will automatically intercept long chats!

## Usage

1. Click the GPT Cleaner extension icon in your Chrome toolbar.
2. Toggle the extension on or off.
3. Adjust the **Visible Messages** count. Lower numbers use less memory but require more frequent loading when scrolling up.
4. See how many messages are currently being virtualized ("hidden") to save memory!

## How it works technically

It observes the DOM for `<article>` elements with `data-testid^="conversation-turn-"`. When the count exceeds the threshold, it removes the older articles from the DOM but stores them as detached DOM Nodes in an array, preserving React's internal fiber nodes and event listeners. A sentinel element with an `IntersectionObserver` detects when the user scrolls near the top and seamlessly prepends the next batch of DOM nodes back into the container, adjusting the scroll position so the user experiences zero layout shift.

## License

MIT
