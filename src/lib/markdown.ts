import { browser } from '$app/environment';
import { marked } from 'marked';
import createDOMPurify from 'dompurify';

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

marked.use({
	renderer
});

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
	const normalized = content.replace(/^(#{1,6})([^\s#])/gm, '$1 $2');

	const withHighlights = normalized.replace(/==([^=\n][\s\S]*?)==/g, '<mark>$1</mark>');
	const withUnderline = withHighlights.replace(/\+\+([^+\n][\s\S]*?)\+\+/g, '<u>$1</u>');

	const withGithubAdmonitions = withUnderline.replace(
		/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n((?:>.*(?:\n|$))*)/gim,
		(_, type: string, body: string) => {
			const label = type.toLowerCase();
			const message = body
				.split('\n')
				.map((line: string) => line.replace(/^>\s?/, ''))
				.join('\n')
				.trim();

			return `<div class="md-admonition md-admonition-${label}"><p class="md-admonition-title">${type}</p>\n${message}\n</div>`;
		}
	);

	return withGithubAdmonitions.replace(
		/^:::(note|tip|important|warning|caution)\s*\n([\s\S]*?)\n:::/gim,
		(_, type: string, body: string) => {
			const upper = type.toUpperCase();
			const label = type.toLowerCase();
			return `<div class="md-admonition md-admonition-${label}"><p class="md-admonition-title">${upper}</p>\n${body.trim()}\n</div>`;
		}
	);
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
	const html = marked.parse(normalized, { async: false });
	const sanitized = purifier.sanitize(html, {
		USE_PROFILES: { html: true },
		ADD_ATTR: ['target', 'rel', 'class']
	});

	setCachedMarkdown(content, sanitized);
	return sanitized;
};
