const {
	MarkdownRenderChild,
	Notice,
	Plugin,
	normalizePath,
} = require("obsidian");

const NOTELET_LANGUAGE = "notelet";
const NOTELETS_FOLDER = "Notelets";

module.exports = class NoteletsPlugin extends Plugin {
	async onload() {
		console.log("Loading Notelets");

		/*
		 * Load persistent Notelet state.
		 */
		this.noteletData = (await this.loadData()) || {};
		this.noteletData.storage ??= {};

		/*
		 * Listen for persistence messages coming from Notelet iframes.
		 */
		this.registerDomEvent(window, "message", (event) => {
			void this.handleNoteletMessage(event);
		});

		/*
		 * Render ```notelet blocks as sandboxed interactive apps.
		 */
		this.registerMarkdownCodeBlockProcessor(
			NOTELET_LANGUAGE,
			(source, el, ctx) => {
				const noteletId = ctx.sourcePath;

				const storage =
					this.noteletData.storage[noteletId] || {};

				const child = new NoteletRenderChild(
					el,
					source,
					noteletId,
					storage
				);

				ctx.addChild(child);
			}
		);

		/*
		 * Import a single self-contained HTML file.
		 */
		this.addCommand({
			id: "import-html-as-notelet",
			name: "Import HTML as Notelet",
			callback: () => {
				void this.importHtmlFile();
			},
		});

		/*
		 * Import an HTML app folder.
		 *
		 * Local CSS and JS files referenced by the HTML are bundled
		 * directly into the resulting Notelet.
		 */
		this.addCommand({
			id: "import-notelet-folder",
			name: "Import app folder as Notelet",
			callback: () => {
				void this.importNoteletFolder();
			},
		});

		this.addRibbonIcon(
			"file-code-2",
			"Import HTML as Notelet",
			() => {
				void this.importHtmlFile();
			}
		);
	}

	/*
	 * ============================================================
	 * SINGLE HTML IMPORT
	 * ============================================================
	 */

	async importHtmlFile() {
		const input = document.createElement("input");

		input.type = "file";
		input.accept = ".html,.htm,text/html";
		input.multiple = false;

		input.addEventListener(
			"change",
			() => {
				const file = input.files?.[0];

				if (!file) {
					return;
				}

				void this.createNoteletFromHtml(
					file.name,
					file.text()
				);
			},
			{ once: true }
		);

		input.click();
	}

	/*
	 * ============================================================
	 * FOLDER IMPORT
	 * ============================================================
	 */

	async importNoteletFolder() {
		const input = document.createElement("input");

		input.type = "file";
		input.multiple = true;

		/*
		 * Chromium/Electron directory selection.
		 * Obsidian Desktop runs on Electron, so this works there.
		 */
		input.setAttribute("webkitdirectory", "");
		input.setAttribute("directory", "");

		input.addEventListener(
			"change",
			() => {
				const files = Array.from(input.files || []);

				if (!files.length) {
					return;
				}

				void this.createNoteletFromFolder(files);
			},
			{ once: true }
		);

		input.click();
	}

	async createNoteletFromFolder(files) {
		try {
			const fileMap = this.buildFileMap(files);

			const htmlFile = this.findEntryHtml(files);

			if (!htmlFile) {
				new Notice(
					"No HTML file was found in that folder."
				);
				return;
			}

			let html = await htmlFile.text();

			html = await this.bundleLocalStylesheets(
				html,
				htmlFile,
				fileMap
			);

			html = await this.bundleLocalScripts(
				html,
				htmlFile,
				fileMap
			);

			const appName =
				this.getFolderName(htmlFile) ||
				removeHtmlExtension(htmlFile.name);

			await this.createNoteletFromResolvedHtml(
				appName,
				html,
				htmlFile.name
			);
		} catch (error) {
			console.error(
				"Notelet folder import failed:",
				error
			);

			new Notice(
				"Could not import the Notelet folder. Check the developer console."
			);
		}
	}

	buildFileMap(files) {
		const map = new Map();

		for (const file of files) {
			const relative =
				file.webkitRelativePath || file.name;

			map.set(
				normalizeRelativePath(relative),
				file
			);
		}

		return map;
	}

	findEntryHtml(files) {
		/*
		 * Prefer index.html.
		 */
		const indexFile = files.find((file) =>
			/(^|\/)index\.html?$/i.test(
				file.webkitRelativePath || file.name
			)
		);

		if (indexFile) {
			return indexFile;
		}

		/*
		 * Otherwise use the first HTML file.
		 */
		return files.find((file) =>
			/\.html?$/i.test(file.name)
		);
	}

	getFolderName(file) {
		const path = file.webkitRelativePath;

		if (!path) {
			return "";
		}

		return path.split("/")[0] || "";
	}

	/*
	 * ============================================================
	 * CSS BUNDLING
	 * ============================================================
	 */

	async bundleLocalStylesheets(
		html,
		htmlFile,
		fileMap
	) {
		const pattern =
			/<link\b([^>]*?)href=["']([^"']+)["']([^>]*?)>/gi;

		const matches = Array.from(
			html.matchAll(pattern)
		);

		for (const match of matches) {
			const fullTag = match[0];
			const before = match[1] || "";
			const href = match[2];
			const after = match[3] || "";

			const attributes = `${before} ${after}`;

			/*
			 * Only replace stylesheet links.
			 */
			if (
				!/\brel\s*=\s*["']?stylesheet/i.test(
					attributes
				)
			) {
				continue;
			}

			/*
			 * Leave web URLs and data URLs alone.
			 */
			if (isExternalResource(href)) {
				continue;
			}

			const cssFile = resolveRelatedFile(
				htmlFile,
				href,
				fileMap
			);

			if (!cssFile) {
				console.warn(
					`Notelets: Could not resolve stylesheet: ${href}`
				);
				continue;
			}

			let css = await cssFile.text();

			/*
			 * Convert local url(...) references inside CSS
			 * to embedded data URLs where possible.
			 */
			css = await this.bundleCssAssets(
				css,
				cssFile,
				fileMap
			);

			const replacement = [
				`<style data-notelet-source="${escapeHtmlAttribute(href)}">`,
				css,
				"</style>",
			].join("\n");

			html = html.replace(
				fullTag,
				replacement
			);
		}

		return html;
	}

	async bundleCssAssets(
		css,
		cssFile,
		fileMap
	) {
		const pattern =
			/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

		const matches = Array.from(
			css.matchAll(pattern)
		);

		for (const match of matches) {
			const fullValue = match[0];
			const resource = match[2].trim();

			if (isExternalResource(resource)) {
				continue;
			}

			if (resource.startsWith("#")) {
				continue;
			}

			const assetFile = resolveRelatedFile(
				cssFile,
				resource,
				fileMap
			);

			if (!assetFile) {
				continue;
			}

			const dataUrl =
				await fileToDataUrl(assetFile);

			css = css.replace(
				fullValue,
				`url("${dataUrl}")`
			);
		}

		return css;
	}

	/*
	 * ============================================================
	 * JAVASCRIPT BUNDLING
	 * ============================================================
	 */

	async bundleLocalScripts(
		html,
		htmlFile,
		fileMap
	) {
		const pattern =
			/<script\b([^>]*?)src=["']([^"']+)["']([^>]*)><\/script>/gi;

		const matches = Array.from(
			html.matchAll(pattern)
		);

		for (const match of matches) {
			const fullTag = match[0];
			const before = match[1] || "";
			const src = match[2];
			const after = match[3] || "";

			if (isExternalResource(src)) {
				continue;
			}

			const jsFile = resolveRelatedFile(
				htmlFile,
				src,
				fileMap
			);

			if (!jsFile) {
				console.warn(
					`Notelets: Could not resolve script: ${src}`
				);
				continue;
			}

			const js = await jsFile.text();

			/*
			 * Preserve useful script attributes such as type="module".
			 * Remove src because the source is now inline.
			 */
			const attributes =
				`${before} ${after}`.trim();

			const replacement = [
				`<script ${attributes} data-notelet-source="${escapeHtmlAttribute(src)}">`,
				js,
				"</script>",
			].join("\n");

			html = html.replace(
				fullTag,
				replacement
			);
		}

		return html;
	}

	/*
	 * ============================================================
	 * NOTE CREATION
	 * ============================================================
	 */

	async createNoteletFromHtml(
		filename,
		htmlPromise
	) {
		try {
			const html = await htmlPromise;

			if (!html.trim()) {
				new Notice(
					"The selected HTML file is empty."
				);
				return;
			}

			await this.createNoteletFromResolvedHtml(
				removeHtmlExtension(filename),
				html,
				filename
			);
		} catch (error) {
			console.error(
				"Notelet import failed:",
				error
			);

			new Notice(
				"Could not create the Notelet. Check the developer console."
			);
		}
	}

	async createNoteletFromResolvedHtml(
		name,
		html,
		sourceName
	) {
		await this.ensureFolder(
			NOTELETS_FOLDER
		);

		const safeName =
			sanitizeFileName(name);

		const notePath =
			await this.getAvailableNotePath(
				NOTELETS_FOLDER,
				safeName
			);

		const fence =
			createSafeFence(html);

		const markdown = [
			"---",
			"notelet: true",
			"notelet-version: 1",
			`source-file: "${escapeYamlString(sourceName)}"`,
			`imported: "${new Date().toISOString()}"`,
			"---",
			"",
			`${fence}${NOTELET_LANGUAGE}`,
			html,
			fence,
			"",
		].join("\n");

		const createdFile =
			await this.app.vault.create(
				notePath,
				markdown
			);

		new Notice(
			`Created Notelet: ${createdFile.basename}`
		);

		const leaf =
			this.app.workspace.getLeaf(false);

		await leaf.setViewState({
			type: "markdown",
			state: {
				file: createdFile.path,
				mode: "preview",
				source: false,
			},
		});
	}

	/*
	 * ============================================================
	 * NOTELET STORAGE BRIDGE
	 * ============================================================
	 */

	async handleNoteletMessage(event) {
		const message = event.data;

		if (
			!message ||
			message.type !==
				"notelets-storage"
		) {
			return;
		}

		const noteletId =
			message.noteletId;

		if (!noteletId) {
			return;
		}

		this.noteletData.storage[noteletId] ??= {};

		switch (message.action) {
			case "set":
				this.noteletData.storage[noteletId][
					message.key
				] = String(message.value);
				break;

			case "remove":
				delete this.noteletData.storage[
					noteletId
				][message.key];
				break;

			case "clear":
				this.noteletData.storage[noteletId] = {};
				break;

			default:
				return;
		}

		await this.saveData(
			this.noteletData
		);
	}

	async ensureFolder(folderPath) {
		const normalized =
			normalizePath(folderPath);

		if (
			this.app.vault.getAbstractFileByPath(
				normalized
			)
		) {
			return;
		}

		await this.app.vault.createFolder(
			normalized
		);
	}

	async getAvailableNotePath(
		folder,
		baseName
	) {
		let counter = 0;

		while (true) {
			const suffix =
				counter === 0
					? ""
					: ` ${counter}`;

			const path =
				normalizePath(
					`${folder}/${baseName}${suffix}.md`
				);

			if (
				!this.app.vault.getAbstractFileByPath(
					path
				)
			) {
				return path;
			}

			counter++;
		}
	}
};


/*
 * ============================================================
 * NOTELET RENDERER
 * ============================================================
 */

class NoteletRenderChild extends MarkdownRenderChild {
	constructor(
		containerEl,
		html,
		noteletId,
		storage
	) {
		super(containerEl);

		this.html = html;
		this.noteletId = noteletId;
		this.storage = storage;
		this.iframe = null;
	}

	onload() {
		this.containerEl.empty();
		this.containerEl.addClass(
			"notelet-container"
		);

		this.iframe =
			document.createElement("iframe");

		this.iframe.addClass(
			"notelet-frame"
		);

		const bridgedHtml =
			injectStorageBridge(
				this.html,
				this.noteletId,
				this.storage
			);

		this.iframe.srcdoc =
			bridgedHtml;

		/*
		 * Scripts can run, but Notelets remain isolated from
		 * Obsidian's own DOM and JavaScript environment.
		 */
		this.iframe.setAttribute(
			"sandbox",
			[
				"allow-scripts",
				"allow-forms",
				"allow-modals",
				"allow-downloads",
			].join(" ")
		);

		this.iframe.setAttribute(
			"title",
			"Notelet"
		);

		this.containerEl.appendChild(
			this.iframe
		);
	}

	onunload() {
		if (this.iframe) {
			this.iframe.srcdoc = "";
			this.iframe.remove();
			this.iframe = null;
		}
	}
}


/*
 * ============================================================
 * STORAGE SHIM
 * ============================================================
 */

function injectStorageBridge(
	html,
	noteletId,
	storedValues
) {
	const safeId =
		JSON.stringify(noteletId);

	const safeStorage =
		JSON.stringify(storedValues || {});

	const bridge = `
<script>
(() => {
	const NOTELET_ID = ${safeId};
	const values = ${safeStorage};

	const storage = {
		get length() {
			return Object.keys(values).length;
		},

		key(index) {
			return Object.keys(values)[index] ?? null;
		},

		getItem(key) {
			key = String(key);

			return Object.prototype.hasOwnProperty.call(
				values,
				key
			)
				? values[key]
				: null;
		},

		setItem(key, value) {
			key = String(key);
			value = String(value);

			values[key] = value;

			window.parent.postMessage(
				{
					type: "notelets-storage",
					action: "set",
					noteletId: NOTELET_ID,
					key,
					value
				},
				"*"
			);
		},

		removeItem(key) {
			key = String(key);

			delete values[key];

			window.parent.postMessage(
				{
					type: "notelets-storage",
					action: "remove",
					noteletId: NOTELET_ID,
					key
				},
				"*"
			);
		},

		clear() {
			for (const key of Object.keys(values)) {
				delete values[key];
			}

			window.parent.postMessage(
				{
					type: "notelets-storage",
					action: "clear",
					noteletId: NOTELET_ID
				},
				"*"
			);
		}
	};

	try {
		Object.defineProperty(
			window,
			"localStorage",
			{
				value: storage,
				configurable: true
			}
		);
	} catch (error) {
		console.warn(
			"Notelets could not install the localStorage bridge.",
			error
		);
	}
})();
</script>
`;

	/*
	 * Inject before the app's own scripts run.
	 */
	if (/<head[^>]*>/i.test(html)) {
		return html.replace(
			/<head([^>]*)>/i,
			`<head$1>${bridge}`
		);
	}

	return bridge + html;
}


/*
 * ============================================================
 * FILE RESOLUTION
 * ============================================================
 */

function resolveRelatedFile(
	sourceFile,
	resourcePath,
	fileMap
) {
	const cleaned =
		resourcePath
			.split("?")[0]
			.split("#")[0];

	const sourcePath =
		normalizeRelativePath(
			sourceFile.webkitRelativePath ||
				sourceFile.name
		);

	const sourceDirectory =
		sourcePath.includes("/")
			? sourcePath.slice(
					0,
					sourcePath.lastIndexOf("/") + 1
				)
			: "";

	const resolved =
		resolvePath(
			sourceDirectory,
			cleaned
		);

	if (fileMap.has(resolved)) {
		return fileMap.get(resolved);
	}

	/*
	 * Fallback: try matching the tail of the path.
	 */
	for (const [path, file] of fileMap) {
		if (
			path === cleaned ||
			path.endsWith("/" + cleaned)
		) {
			return file;
		}
	}

	return null;
}

function resolvePath(
	baseDirectory,
	resource
) {
	const parts =
		`${baseDirectory}${resource}`
			.replace(/\\/g, "/")
			.split("/");

	const resolved = [];

	for (const part of parts) {
		if (
			!part ||
			part === "."
		) {
			continue;
		}

		if (part === "..") {
			resolved.pop();
			continue;
		}

		resolved.push(part);
	}

	return resolved.join("/");
}

function normalizeRelativePath(path) {
	return path
		.replace(/\\/g, "/")
		.replace(/^\/+/, "");
}

function isExternalResource(value) {
	return (
		/^[a-z][a-z0-9+.-]*:/i.test(
			value
		) ||
		value.startsWith("//") ||
		value.startsWith("#")
	);
}


/*
 * ============================================================
 * DATA URL SUPPORT
 * ============================================================
 */

function fileToDataUrl(file) {
	return new Promise(
		(resolve, reject) => {
			const reader =
				new FileReader();

			reader.onload = () =>
				resolve(reader.result);

			reader.onerror = () =>
				reject(reader.error);

			reader.readAsDataURL(file);
		}
	);
}


/*
 * ============================================================
 * GENERAL HELPERS
 * ============================================================
 */

function removeHtmlExtension(filename) {
	return filename.replace(
		/\.html?$/i,
		""
	);
}

function sanitizeFileName(filename) {
	const sanitized =
		filename
			.replace(
				/[\\/:*?"<>|]/g,
				"-"
			)
			.replace(/\s+/g, " ")
			.trim();

	return (
		sanitized ||
		"Untitled Notelet"
	);
}

function escapeYamlString(value) {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"');
}

function escapeHtmlAttribute(value) {
	return String(value)
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function createSafeFence(content) {
	const matches =
		content.match(/`+/g);

	let longest = 2;

	if (matches) {
		for (const match of matches) {
			longest = Math.max(
				longest,
				match.length
			);
		}
	}

	return "`".repeat(
		Math.max(
			3,
			longest + 1
		)
	);
}