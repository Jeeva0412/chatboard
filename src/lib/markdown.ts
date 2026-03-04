import { browser } from '$app/environment';
import { marked } from 'marked';
import createDOMPurify from 'dompurify';

marked.setOptions({
	gfm: true,
	breaks: true
});

const purifier = browser ? createDOMPurify(window) : null;

const normalizeMarkdown = (content: string) => {
	return content
		.split('\n')
		.map((line) => line.replace(/^(#{1,6})([^\s#])/, '$1 $2'))
		.join('\n');
};

export const renderMarkdown = (content: string) => {
	if (!browser || !purifier) {
		return content;
	}

	const normalized = normalizeMarkdown(content);
	const html = marked.parse(normalized, { async: false });
	return purifier.sanitize(html, {
		USE_PROFILES: { html: true }
	});
};
