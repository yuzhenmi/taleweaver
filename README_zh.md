# Taleweaver

说明: 该项目目前处在研发阶段，可以在这里看到示例： https://yuzhenmi.github.io/taleweaver/.


该项目是作为[2Tale Writer's Portal](https://writer.2tale.com/)的核心编辑器来开发的。项目的目标是保持编辑器核心的最小化和可扩展性，覆盖必要的功能以便有机会将其扩展到更具体的用例中。

## 又造一款编辑器？

目前有相当多的开源所见即所得（WYSIWYG）的编辑器，它们很成熟很强大可扩展性很强且被广泛使用。在大多数场景下，你会在你的项目中使用这些当中的一款。这些编辑器通常依赖浏览器来呈现编辑的文档，并使用ContentEditable特性提供编辑界面。使用这种方法，编辑体验是由浏览器本身提供的，且编辑器可以在用户的输入或是调整之前就把这些变化进行解析和净化。这些编辑器同时可以充分利用CSS和浏览器的布局引擎去渲染和修饰文档的样式。

因为浏览器关注的是布局和渲染，所以这些编辑器不清除内容会渲染在什么地方，这在大多数场景下是可以接受的。然而，当你开发一个依赖布局信息的功能的时候，你可能会遇到一个不能跨越的障碍。

一个很常见的场景就是目前这些开源编辑器不能对文字进行分页处理。要实现这一特性，需要在确定何处分页之前就知道文档是如何被拆分成一行一行的，并且知道每行的尺寸和位置。像谷歌Doc这种有分页功能的商业的云服务文字处理是通过研发自有排版引擎来达到目标的。

Taleweaver 拥有排版引擎同时提供了一套API来访问排版信息。它的目标就是把word那种风格的文字编辑体验带到开源社区。

## 它的实现方式是？

Taleweaver的工作原理是获取文档状态并将其呈现到屏幕上。当状态发生变化时，这些更改将通过一系列步骤传播到屏幕。

[State] -> [Model Tree] -> [Render Tree] -> [Layout Tree] -> [View Tree]
[状态] -> [模型树] -> [呈现树] -> [布局树] -> [视图树]


### State（状态）

文档的State是用一系列的水平的token来表示的. 共有三种token:
* Open tag token - Marks the beginning of a element in the document.（标记文档中元素的开始）
* Close tag token - Marks the end of an element in the document.（标记文档中元素的结尾）
* Character token - A character in the document's content.（文档内容的一个字符）

State允许在数组上以插入或删除的形式进行更改。这个简单的接口能够实现以最小的工作量实现协作编辑。

便于存储和基于文本的传输，state可以序列化为标记，且能够通过分词相关技术从标记中恢复。

### Model Tree（模型树）

文档很难通过一组水平的token来表示，因此它被解析为Model Tree。Model Tree包含文档的所有元素并作为节点，文档元素作为根节点，内联内容作为叶节点。结构化的元素（如块）表示为分支节点。每个元素类型都可以设定一套约束规则来决定允许哪些类型的父级和子级节点。


### Render Tree（呈现树）

Model Tree描述文档包含的内容。Render Tree描述如何显示文档。Model Tree的元素射到相应的Render Tree元素，其中包含有关表示的信息。例如，段落应呈现为一个块，而文本应呈现为内联。


### Layout Tree（布局树）

Render Tree描述如何展现，而Layout Tree将展现信息应用于具有大小限制的物理文档。除了从Render Tree中继承元素之外，Layout Tree还包括描述页面和行的流动元素。考虑到文档的大小和文档内容，布局引擎分解文档中的各种元素以生成Layout Tree。Layout Tree中的每个元素都存储自己的大小，以便高效地检索布局信息。


### View Tree（视图树）

View Tree将Layout Tree绑定到浏览器视区。View Tree中的每个元素与布局树Layout Tree元素一一对应。
