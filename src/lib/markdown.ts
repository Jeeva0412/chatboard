import { browser } from '$app/environment';
import { marked, type Token } from 'marked';
import createDOMPurify from 'dompurify';
import customHeadingId from 'marked-custom-heading-id';
import markedFootnote from 'marked-footnote';
import { emojify } from 'node-emoji';
marked.setOptions({
	gfm: true,
	breaks: true
});

const renderer = new marked.Renderer();

const normalizeLinkHref = (href: string | null) => {
	if (!href) {
		return '';
	}

	if (/^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i.test(href)) {
		return href;
	}

	return `https://${href}`;
};

renderer.link = function ({ href, title, tokens }) {
	const safeHref = normalizeLinkHref(href);
	const text = this.parser.parseInline(tokens ?? []);
	const titlePart = title ? ` title="${title}"` : '';
	return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer"${titlePart}>${text}</a>`;
};

// Definition List extension
const defListExtension = {
	name: 'defList',
	level: 'block',
	start(src: string) { return src.match(/^[^\n]+\n:\s/)?.index; },
	tokenizer(this: any, src: string, tokens: Token[]) {
		const rule = /^([^\n]+)\n((?::\s+[^\n]+(?:\n|$))+)/;
		const match = rule.exec(src);
		if (match) {
			return {
				type: 'defList',
				raw: match[0],
				dt: this.lexer.inlineTokens(match[1].trim()),
				dd: match[2].trim().split('\n').map((line: string) => this.lexer.inlineTokens(line.replace(/^:\s+/, '').trim()))
			};
		}
		return undefined;
	},
	renderer(this: any, token: any) {
		const dt = this.parser.parseInline(token.dt);
		const ddHtml = token.dd.map((ddTokens: any) => `<dd>${this.parser.parseInline(ddTokens)}</dd>`).join('');
		return `<dl><dt>${dt}</dt>${ddHtml}</dl>`;
	}
};

marked.use({
	renderer,
	extensions: [defListExtension]
});

marked.use(customHeadingId());
marked.use(markedFootnote());

const purifier = browser ? createDOMPurify(window) : null;
const markdownCache = new Map<string, string>();
const markdownCacheLimit = 300;

const getCachedMarkdown = (content: string) => {
	const cached = markdownCache.get(content);
	if (!cached) {
		return null;
	}

	markdownCache.delete(content);
	markdownCache.set(content, cached);
	return cached;
};

const setCachedMarkdown = (content: string, rendered: string) => {
	if (markdownCache.has(content)) {
		markdownCache.delete(content);
	}

	markdownCache.set(content, rendered);

	if (markdownCache.size > markdownCacheLimit) {
		const oldestKey = markdownCache.keys().next().value as string | undefined;
		if (oldestKey) {
			markdownCache.delete(oldestKey);
		}
	}
};

const normalizeMarkdown = (content: string) => {
	// Emojify first
	const withEmojis = emojify(content);

	// Fix headers missing space (e.g. ###Hello -> ### Hello)
	const withHeaderSpace = withEmojis.replace(/^(#{1,6})(?=[^#\s])/gm, '$1 ');

	const withHighlights = withHeaderSpace.replace(/==([^=\n][\s\S]*?)==/g, '<mark>$1</mark>');
	const withUnderline = withHighlights.replace(/\+\+([^+\n][\s\S]*?)\+\+/g, '<u>$1</u>');
	const withSubscript = withUnderline.replace(/~([^~\n]+)~/g, '<sub>$1</sub>');
	const withSuperscript = withSubscript.replace(/\^([^\^\n]+)\^/g, '<sup>$1</sup>');

	return withSuperscript;
};


export const renderMarkdown = (content: string) => {
	if (!browser || !purifier) {
		return content;
	}

	const cached = getCachedMarkdown(content);
	if (cached) {
		return cached;
	}

	const normalized = normalizeMarkdown(content);
	const html = marked.parse(normalized, { async: false }) as string;
	const sanitized = purifier.sanitize(html, {
		USE_PROFILES: { html: true },
		ADD_ATTR: ['target', 'rel', 'class', 'id']
	});

	setCachedMarkdown(content, sanitized);
	return sanitized;
};
