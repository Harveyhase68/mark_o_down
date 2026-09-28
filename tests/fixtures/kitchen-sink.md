---
title: Kitchen Sink
tags: [a, b]
---

# Mark O Down 😂 👨‍👩‍👧‍👦 🇦🇹

[![npm](https://img.shields.io/npm/v/npm.svg?logo=nodedotjs)](https://www.npmjs.com/package/npm)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) ![build][badge-ci]

Setext Heading
==============

Second Level
------------

A paragraph with **bold**, __underscore bold__, *em*, _underscore em_, ***both***,
~~strike~~, `code`, `` a`b ``, a [link](https://example.com "Title") and an
autolink <https://example.org> plus a literal www.example.com and mail@example.com.
Escapes: \*not em\*, 1\. not a list, snake_case_word, 5 * 3, a < b, AT&amp;T, &copy;.
Line with two trailing spaces  
and a backslash break\
done. Emoji inline 🧑🏽‍💻 and 𝕏 and 𠜎.

## Lists

* star item
* second with **bold**
  continuation line
* third

- [ ] open task
- [x] done task

1. one
2. two
   1. nested one
   2. nested two
3. three

3) paren start
4) next

+ loose item one

+ loose item two

  second paragraph in item

- item with code

  ```js
  const x = 1;
  ```

> A quote with *emphasis*
> > nested quote
>
> - list in quote

```rust title="main.rs"
fn main() {
    println!("🦀");
}
```

~~~
tilde fence
~~~

    indented code
    block

***

- - -

| Column A | Column B |
|:---------|---------:|
| 1        | **2**    |

<div align="center">
  <img src="logo.png" width="100">
</div>

Text with <kbd>Ctrl</kbd>+<kbd>S</kbd> inline html and a footnote[^1].

[^1]: The footnote text.

Reference [link][ref] and [collapsed][] and [shortcut].

[ref]: https://example.com/ref "Ref Title"
[collapsed]: https://example.com/collapsed
[shortcut]: <https://example.com/short cut>
[badge-ci]: https://img.shields.io/github/actions/workflow/status/o/r/ci.yml

Final paragraph without trailing newline magic.
