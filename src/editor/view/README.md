# View

This module is responsible for rendering the editor state to the browser, and for translating browser events to editor state transformations. React is used to handle rendering.

Since the project aims to be fully aware of where things are rendered, this module breaks up a document into tokens, determines the dimensions for each token, and lays them out as lines on pages before committing to render.

A token is a piece of the document that needs to be rendered and cannot be broken up to multiple lines. This is a useful abstraction because tokens can be treated as atomic rendering units, and the determination of layout is simplified to fitting the pages with tokens.
