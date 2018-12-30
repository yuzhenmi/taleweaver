# Model

This module is responsible for modelling the state of the document and its elements.

The model architecture makes the core assumption that a document contains pages, a page contains blocks, and a block contains inline elements. When developing additional element types, the new element type should behave as either a block or inline element. This architecture may potentially also allow the document or page elements to be replaced with custom implementation.
