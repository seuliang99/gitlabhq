/* eslint-disable object-shorthand, no-unused-vars, no-use-before-define, no-restricted-syntax, guard-for-in, no-continue */

import $ from 'jquery';
import _ from 'underscore';
import { insertText, getSelectedFragment, nodeMatchesSelector } from '~/lib/utils/common_utils';
import { placeholderImage } from '~/lazy_loader';
import schema from '~/vue_shared/components/markdown/schema'
import markdownSerializer from '~/vue_shared/components/markdown/markdown_serializer';
import { DOMParser } from 'prosemirror-model'

const gfmRules = {
  TaskListFilter: {
    'input[type=checkbox].task-list-item-checkbox'(el) {
      return `[${el.checked ? 'x' : ' '}]`;
    },
  },
  TableOfContentsFilter: {
    'ul.section-nav'(el) {
      return '[[_TOC_]]';
    },
  },
  MarkdownFilter: {
    'code'(el, text) {
      let backtickCount = 1;
      const backtickMatch = text.match(/`+/);
      if (backtickMatch) {
        backtickCount = backtickMatch[0].length + 1;
      }

      const backticks = Array(backtickCount + 1).join('`');
      const spaceOrNoSpace = backtickCount > 1 ? ' ' : '';

      return backticks + spaceOrNoSpace + text.trim() + spaceOrNoSpace + backticks;
    },
    'table'(el) {
      const theadEl = el.querySelector('thead');
      const tbodyEl = el.querySelector('tbody');
      if (!theadEl || !tbodyEl) return false;

      const theadText = CopyAsGFM.nodeToGFM(theadEl);
      const tbodyText = CopyAsGFM.nodeToGFM(tbodyEl);

      return [theadText, tbodyText].join('\n');
    },
    'thead'(el, text) {
      const cells = _.map(el.querySelectorAll('th'), (cell) => {
        let chars = CopyAsGFM.nodeToGFM(cell).length + 2;

        let before = '';
        let after = '';
        const alignment = cell.align || cell.style.textAlign;

        switch (alignment) {
          case 'center':
            before = ':';
            after = ':';
            chars -= 2;
            break;
          case 'right':
            after = ':';
            chars -= 1;
            break;
          default:
            break;
        }

        chars = Math.max(chars, 3);

        const middle = Array(chars + 1).join('-');

        return before + middle + after;
      });

      const separatorRow = `|${cells.join('|')}|`;

      return [text, separatorRow].join('\n');
    },
    'tr'(el) {
      const cellEls = el.querySelectorAll('td, th');
      if (cellEls.length === 0) return false;

      const cells = _.map(cellEls, cell => CopyAsGFM.nodeToGFM(cell));
      return `| ${cells.join(' | ')} |`;
    },
  },
};

export class CopyAsGFM {
  constructor() {
    // iOS currently does not support clipboardData.setData(). This bug should
    // be fixed in iOS 12, but for now we'll disable this for all iOS browsers
    // ref: https://trac.webkit.org/changeset/222228/webkit
    const userAgent = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    const isIOS = /\b(iPad|iPhone|iPod)(?=;)/.test(userAgent);
    if (isIOS) return;

    $(document).on('copy', '.md, .wiki', (e) => { CopyAsGFM.copyAsGFM(e, CopyAsGFM.transformGFMSelection); });
    $(document).on('copy', 'pre.code.highlight, .diff-content .line_content', (e) => { CopyAsGFM.copyAsGFM(e, CopyAsGFM.transformCodeSelection); });
    $(document).on('paste', '.js-gfm-input', CopyAsGFM.pasteGFM);
  }

  static copyAsGFM(e, transformer) {
    const { clipboardData } = e.originalEvent;
    if (!clipboardData) return;

    const documentFragment = getSelectedFragment();
    if (!documentFragment) return;

    const el = transformer(documentFragment.cloneNode(true), e.currentTarget);
    if (!el) return;

    e.preventDefault();
    e.stopPropagation();

    clipboardData.setData('text/plain', el.textContent);
    clipboardData.setData('text/x-gfm', this.nodeToGFM(el));

    const div = document.createElement("div");
    div.appendChild(el);
    const html = div.innerHTML;

    clipboardData.setData('text/html', html);
  }

  static pasteGFM(e) {
    const { clipboardData } = e.originalEvent;
    if (!clipboardData) return;

    const text = clipboardData.getData('text/plain');
    const gfm = clipboardData.getData('text/x-gfm');
    if (!gfm) return;

    e.preventDefault();

    window.gl.utils.insertText(e.target, (textBefore, textAfter) => {
      // If the text before the cursor contains an odd number of backticks,
      // we are either inside an inline code span that starts with 1 backtick
      // or a code block that starts with 3 backticks.
      // This logic still holds when there are one or more _closed_ code spans
      // or blocks that will have 2 or 6 backticks.
      // This will break down when the actual code block contains an uneven
      // number of backticks, but this is a rare edge case.
      const backtickMatch = textBefore.match(/`/g);
      const insideCodeBlock = backtickMatch && (backtickMatch.length % 2) === 1;

      if (insideCodeBlock) {
        return text;
      }

      return gfm;
    });
  }

  static transformGFMSelection(documentFragment) {
    const gfmElements = documentFragment.querySelectorAll('.md, .wiki');
    switch (gfmElements.length) {
      case 0: {
        return documentFragment;
      }
      case 1: {
        return gfmElements[0];
      }
      default: {
        const allGfmElement = document.createElement('div');

        for (let i = 0; i < gfmElements.length; i += 1) {
          const gfmElement = gfmElements[i];
          allGfmElement.appendChild(gfmElement);
          allGfmElement.appendChild(document.createTextNode('\n\n'));
        }

        return allGfmElement;
      }
    }
  }

  static transformCodeSelection(documentFragment, target) {
    let lineSelector = '.line';

    if (target) {
      const lineClass = ['left-side', 'right-side'].filter(name => target.classList.contains(name))[0];
      if (lineClass) {
        lineSelector = `.line_content.${lineClass} ${lineSelector}`;
      }
    }

    const lineElements = documentFragment.querySelectorAll(lineSelector);

    let codeElement;
    if (lineElements.length > 1) {
      codeElement = document.createElement('pre');
      codeElement.className = 'code highlight';

      const lang = lineElements[0].getAttribute('lang');
      if (lang) {
        codeElement.setAttribute('lang', lang);
      }
    } else {
      codeElement = document.createElement('code');
    }

    if (lineElements.length > 0) {
      for (let i = 0; i < lineElements.length; i += 1) {
        const lineElement = lineElements[i];
        codeElement.appendChild(lineElement);
        codeElement.appendChild(document.createTextNode('\n'));
      }
    } else {
      codeElement.appendChild(documentFragment);
    }

    return codeElement;
  }

  static nodeToGFM(node, respectWhitespaceParam = false) {
    const wrapEl = document.createElement('div');
    wrapEl.appendChild(node);
    const doc = DOMParser.fromSchema(schema).parse(wrapEl);

    return markdownSerializer.serialize(doc);
  }
}

// Export CopyAsGFM as a global for rspec to access
// see /spec/features/copy_as_gfm_spec.rb
if (process.env.NODE_ENV !== 'production') {
  window.CopyAsGFM = CopyAsGFM;
}

export default function initCopyAsGFM() {
  return new CopyAsGFM();
}
