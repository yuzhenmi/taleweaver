[中文说明](./README_zh.md)

# Taleweaver

NOTE: This project is still work-in-progress, demo of the latest code is available at https://yuzhenmi.github.io/taleweaver/.

This project is being developed as the editor core for [2Tale Writer's Portal](https://writer.2tale.com/). The goal is to keep the editor core minimal and extensible, covering necessary functionalities with the opportunity to extend it for more specific use cases.

## Contributing

This project can be run for development purpose by building the editor core and running the React example:

```
# In packages/core
npm install  # Install dev dependencies
npm run dev  # Build in watch mode

# In examples/taleweaver-example-react
npm install  # Install dependencies
npm start  # Start dev server (create-react-app)
```

With this setup, you can access the example app at http://localhost:3000. Changes to the editor core will trigger rebuild of the core and reload the example app.

## Why yet another editor?

There are plenty of open-source WYSIWYG editors out there that are mature, powerful, extensible and widely-adopted. In most cases, you'd want to use one of these editors for your project. These editors typically rely on the browser to render the edited document, and use contenteditable to provide an editing interface. With this approach, the editing experience is provided natively by the browser, and the editor can parse and sanitize any user input on the contenteditable, before applying changes to the document. The editor can also take full advantage of CSS and the browser layout engine to render and style the document.

Since the browser takes care of layout and rendering, these editors do not have knowledge of where things are rendered. In most cases, this is acceptable. However, if you are building a feature that does rely on layout information, then this may become an obstacle that cannot be overcome.

One common scenario that existing open-source editors cannot handle is word processor pagination. This feature requires knowing how the document is broken up into lines and the position and size of each line, before determining where pages should break. Commercial cloud-based word processors with the pagination feature such as Google Docs implement their own layout engine to achieve this goal.

Taleweaver includes its own layout engine and provides an API to access layout information. The goal is to bring the word processor style editing experience to the open source community.

## How does it work?

Taleweaver works by taking a document state and rendering it to the screen. When the state is modified through state transformations, the changes are propagated to the screen through a series of steps.

[State] -> [Model Tree] -> [Render Tree] -> [Layout Tree] -> [View Tree]

### State

The document state is represented as a flat array of tokens. There are 3 types of tokens:

- Open tag token - Marks the beginning of a element in the document.
- Close tag token - Marks the end of an element in the document.
- Character token - A character in the document's content.

The state allows transformations as either insertions or deletions on the array. This simple interface should allow collaborative editing to be implemented with minimal effort.

For storage and text-based transport, the state can be serialized into markup, and recovered from markup through tokenization.

### Model Tree

A flat array of tokens is difficult to interpret as a document, so it gets parsed into a model tree. The model tree contains document elements as nodes, with the document element as the root node and inline content as leaf nodes. Structural elements such as blocks are represented as branch nodes. Each element type can enforce its own rules about which types of parent and children to allow.

### Render Tree

The model tree describes what the document contains. The render tree describes how the document should be presented. Elements of the model tree and mapped to corresponding render tree elements with information about presentation. For example, a paragraph should be rendered as a block, whereas text should be rendered inline.

### Layout Tree

The render tree describes presentation, whereas the layout tree applies the presentation information to a physical document with sizing constraints. In addition to carrying over the elements from the render tree, the layout tree also includes flowing elements that describe pages and lines. Given the size of the document and document's content, the layout engine breaks the various elements in the document to produce the layout tree. Each element in the layout tree stores its own size, so that layout information can be retrieved efficiently.

### View Tree

The view tree binds the layout tree to the browser viewport. Each element in the view tree maps one-to-one with layout tree elements.
