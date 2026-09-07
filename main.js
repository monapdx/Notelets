const {
	MarkdownRenderChild,
	Notice,
	Plugin,
	TFile,
	normalizePath,
} = require("obsidian");

const NOTELET_LANGUAGE = "notelet";
const NOTELETS_FOLDER = "Notelets";
const NOTELETS_ASSETS_FOLDER = "Notelets/_assets";

const ASSET_EXTENSIONS = [
	"png",
	"jpg",
	"jpeg",
	"gif",
	"webp",
	"avif",
	"svg",
	"ico",
	"bmp",
	"apng",
	"mp3",
	"wav",
	"ogg",
	"oga",
	"m4a",
	"aac",
	"flac",
	"mp4",
	"webm",
	"ogv",
	"mov",
	"woff",
	"woff2",
	"ttf",
	"otf",
];

const ASSET_EXTENSION_PATTERN = ASSET_EXTENSIONS.join("|");

module.exports = class NoteletsPlugin extends Plugin {
	async onload() {
		console.log("Loading Notelets");

		this.noteletData = (await this.loadData()) || {};
		this.noteletData.storage ??= {};

		this.registerDomEvent(window, "message", (event) => {
			void this.handleNoteletMessage(event);
		});

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
					storage,
					this.app
				);

				ctx.addChild(child);
			}
		);

		this.addCommand({
			id: "create-new-notelet",
			name: "Create new Notelet",
			callback: () => {
				void this.createBlankNotelet();
			},
		});

		this.addCommand({
			id: "import-html-as-notelet",
			name: "Import HTML as Notelet",
			callback: () => {
				void this.importHtmlFile();
			},
		});

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
	 * CREATE BLANK NOTELET
	 * ============================================================
	 */

	async createBlankNotelet() {
		try {
			const name = window.prompt(
				"Name your Notelet:",
				"Untitled Notelet"
			);

			if (!name) {
				return;
			}

			await this.ensureFolderRecursive(
				NOTELETS_FOLDER
			);

			const safeName =
				sanitizeFileName(name);

			const notePath =
				await this.getAvailableNotePath(
					NOTELETS_FOLDER,
					safeName
				);

			const html = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${escapeHtmlText(name)}</title>

	<style>
		body {
			margin: 0;
			padding: 2rem;
			font-family: system-ui, sans-serif;
		}
	</style>
</head>

<body>
	<main id="app">
		<h1>${escapeHtmlText(name)}</h1>
		<p>Your Notelet starts here.</p>
	</main>

	<script>
		// Your Notelet functionality
	</script>
</body>
</html>`;

			await this.createNoteletFile(
				notePath,
				html,
				null,
				null,
				true
			);
		} catch (error) {
			console.error(
				"Could not create blank Notelet:",
				error
			);

			new Notice(
				"Could not create the Notelet. Check the developer console."
			);
		}
	}

	/*
	 * ============================================================
	 * SINGLE HTML IMPORT
	 * ============================================================
	 */

	async importHtmlFile() {
		const input =
			document.createElement("input");

		input.type = "file";
		input.accept =
			".html,.htm,text/html";
		input.multiple = false;

		input.addEventListener(
			"change",
			() => {
				const file =
					input.files?.[0];

				if (!file) {
					return;
				}

				void this.createNoteletFromSingleHtml(
					file
				);
			},
			{ once: true }
		);

		input.click();
	}

	async createNoteletFromSingleHtml(file) {
		try {
			const html =
				await file.text();

			if (!html.trim()) {
				new Notice(
					"The selected HTML file is empty."
				);

				return;
			}

			await this.ensureFolderRecursive(
				NOTELETS_FOLDER
			);

			const safeName =
				sanitizeFileName(
					removeHtmlExtension(
						file.name
					)
				);

			const notePath =
				await this.getAvailableNotePath(
					NOTELETS_FOLDER,
					safeName
				);

			await this.createNoteletFile(
				notePath,
				html,
				file.name,
				null,
				false
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

	/*
	 * ============================================================
	 * FOLDER IMPORT
	 * ============================================================
	 */

	async importNoteletFolder() {
		const input =
			document.createElement("input");

		input.type = "file";
		input.multiple = true;

		input.setAttribute(
			"webkitdirectory",
			""
		);

		input.setAttribute(
			"directory",
			""
		);

		input.addEventListener(
			"change",
			() => {
				const files =
					Array.from(
						input.files || []
					);

				if (!files.length) {
					return;
				}

				void this.createNoteletFromFolder(
					files
				);
			},
			{ once: true }
		);

		input.click();
	}

	async createNoteletFromFolder(files) {
		try {
			const fileMap =
				this.buildFileMap(files);

			const htmlFile =
				this.findEntryHtml(files);

			if (!htmlFile) {
				new Notice(
					"No HTML file was found in that folder."
				);

				return;
			}

			await this.ensureFolderRecursive(
				NOTELETS_FOLDER
			);

			const appName =
				this.getFolderName(htmlFile) ||
				removeHtmlExtension(
					htmlFile.name
				);

			const safeName =
				sanitizeFileName(appName);

			const notePath =
				await this.getAvailableNotePath(
					NOTELETS_FOLDER,
					safeName
				);

			const noteBasename =
				getBasenameFromPath(
					notePath
				);

			const assetRoot =
				normalizePath(
					`${NOTELETS_ASSETS_FOLDER}/${noteBasename}`
				);

			const context = {
				files,
				fileMap,
				htmlFile,
				assetRoot,
				copiedAssets:
					new Map(),
				rootPrefix:
					getRootPrefix(
						htmlFile
					),
			};

			let html =
				await htmlFile.text();

			html =
				await this.bundleLocalStylesheets(
					html,
					htmlFile,
					context
				);

			html =
				await this.bundleLocalScripts(
					html,
					htmlFile,
					context
				);

			html =
				await this.processInlineStyles(
					html,
					htmlFile,
					context
				);

			html =
				await this.processHtmlAssetAttributes(
					html,
					htmlFile,
					context
				);

			html =
				await this.processInlineScripts(
					html,
					htmlFile,
					context
				);

			await this.createNoteletFile(
				notePath,
				html,
				htmlFile.name,
				assetRoot,
				false
			);

			const count =
				context.copiedAssets.size;

			if (count > 0) {
				new Notice(
					`Imported ${count} Notelet asset${count === 1 ? "" : "s"}.`
				);
			}
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
		const map =
			new Map();

		for (const file of files) {
			const relative =
				normalizeRelativePath(
					file.webkitRelativePath ||
						file.name
				);

			map.set(
				relative,
				file
			);
		}

		return map;
	}

	findEntryHtml(files) {
		const indexFile =
			files.find(
				(file) =>
					/(^|\/)index\.html?$/i.test(
						normalizeRelativePath(
							file.webkitRelativePath ||
								file.name
						)
					)
			);

		if (indexFile) {
			return indexFile;
		}

		return files.find(
			(file) =>
				/\.html?$/i.test(
					file.name
				)
		);
	}

	getFolderName(file) {
		const path =
			normalizeRelativePath(
				file.webkitRelativePath || ""
			);

		if (!path) {
			return "";
		}

		return (
			path.split("/")[0] ||
			""
		);
	}

	/*
	 * ============================================================
	 * CSS BUNDLING
	 * ============================================================
	 */

	async bundleLocalStylesheets(
		html,
		htmlFile,
		context
	) {
		const regex =
			/<link\b([^>]*?)href=["']([^"']+)["']([^>]*?)>/gi;

		return await replaceMatchesAsync(
			html,
			regex,
			async (match) => {
				const fullTag =
					match[0];

				const before =
					match[1] || "";

				const href =
					match[2];

				const after =
					match[3] || "";

				const attributes =
					`${before} ${after}`;

				if (
					!/\brel\s*=\s*["']?stylesheet/i.test(
						attributes
					)
				) {
					return fullTag;
				}

				if (
					isExternalResource(
						href
					)
				) {
					return fullTag;
				}

				const cssFile =
					resolveRelatedFile(
						htmlFile,
						href,
						context.fileMap
					);

				if (!cssFile) {
					console.warn(
						`Notelets: Could not resolve stylesheet: ${href}`
					);

					return fullTag;
				}

				let css =
					await cssFile.text();

				css =
					await this.processCssAssetReferences(
						css,
						cssFile,
						context
					);

				return [
					`<style data-notelet-source="${escapeHtmlAttribute(href)}">`,
					css,
					"</style>",
				].join("\n");
			}
		);
	}

	/*
	 * ============================================================
	 * JS BUNDLING
	 * ============================================================
	 */

	async bundleLocalScripts(
		html,
		htmlFile,
		context
	) {
		const regex =
			/<script\b([^>]*?)src=["']([^"']+)["']([^>]*)><\/script>/gi;

		return await replaceMatchesAsync(
			html,
			regex,
			async (match) => {
				const fullTag =
					match[0];

				const before =
					match[1] || "";

				const src =
					match[2];

				const after =
					match[3] || "";

				if (
					isExternalResource(
						src
					)
				) {
					return fullTag;
				}

				const jsFile =
					resolveRelatedFile(
						htmlFile,
						src,
						context.fileMap
					);

				if (!jsFile) {
					console.warn(
						`Notelets: Could not resolve script: ${src}`
					);

					return fullTag;
				}

				let js =
					await jsFile.text();

				js =
					await this.processJavaScriptAssetStrings(
						js,
						jsFile,
						context
					);

				const attributes =
					`${before} ${after}`
						.trim();

				const attrText =
					attributes
						? ` ${attributes}`
						: "";

				return [
					`<script${attrText} data-notelet-source="${escapeHtmlAttribute(src)}">`,
					js,
					"</script>",
				].join("\n");
			}
		);
	}

	/*
	 * ============================================================
	 * INLINE STYLES
	 * ============================================================
	 */

	async processInlineStyles(
		html,
		htmlFile,
		context
	) {
		const regex =
			/<style\b([^>]*)>([\s\S]*?)<\/style>/gi;

		return await replaceMatchesAsync(
			html,
			regex,
			async (match) => {
				const attrs =
					match[1] || "";

				let css =
					match[2] || "";

				css =
					await this.processCssAssetReferences(
						css,
						htmlFile,
						context
					);

				return (
					`<style${attrs}>` +
					css +
					"</style>"
				);
			}
		);
	}

	async processCssAssetReferences(
		css,
		sourceFile,
		context
	) {
		const regex =
			/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

		return await replaceMatchesAsync(
			css,
			regex,
			async (match) => {
				const full =
					match[0];

				const resource =
					match[2].trim();

				if (
					isExternalResource(
						resource
					)
				) {
					return full;
				}

				const placeholder =
					await this.importAssetReference(
						sourceFile,
						resource,
						context
					);

				if (!placeholder) {
					return full;
				}

				return (
					`url("${placeholder}")`
				);
			}
		);
	}

	/*
	 * ============================================================
	 * HTML ASSET ATTRIBUTES
	 * ============================================================
	 */

	async processHtmlAssetAttributes(
		html,
		htmlFile,
		context
	) {
		const attributeRegex =
			/\b(src|poster)=("([^"]*)"|'([^']*)')/gi;

		html =
			await replaceMatchesAsync(
				html,
				attributeRegex,
				async (match) => {
					const full =
						match[0];

					const attribute =
						match[1];

					const quote =
						match[2][0];

					const resource =
						match[3] !== undefined
							? match[3]
							: match[4];

					if (
						!resource ||
						isExternalResource(
							resource
						)
					) {
						return full;
					}

					if (
						!looksLikeAssetPath(
							resource
						)
					) {
						return full;
					}

					const placeholder =
						await this.importAssetReference(
							htmlFile,
							resource,
							context
						);

					if (!placeholder) {
						return full;
					}

					return (
						`${attribute}=${quote}` +
						placeholder +
						quote
					);
				}
			);

		const srcsetRegex =
			/\bsrcset=("([^"]*)"|'([^']*)')/gi;

		html =
			await replaceMatchesAsync(
				html,
				srcsetRegex,
				async (match) => {
					const full =
						match[0];

					const quote =
						match[1][0];

					const value =
						match[2] !== undefined
							? match[2]
							: match[3];

					const entries =
						value
							.split(",")
							.map(
								(entry) =>
									entry.trim()
							)
							.filter(Boolean);

					const output = [];

					for (
						const entry of entries
					) {
						const parts =
							entry.split(
								/\s+/
							);

						const resource =
							parts.shift();

						const descriptor =
							parts.join(" ");

						if (
							!resource ||
							isExternalResource(
								resource
							) ||
							!looksLikeAssetPath(
								resource
							)
						) {
							output.push(
								entry
							);

							continue;
						}

						const placeholder =
							await this.importAssetReference(
								htmlFile,
								resource,
								context
							);

						if (!placeholder) {
							output.push(
								entry
							);

							continue;
						}

						output.push(
							descriptor
								? `${placeholder} ${descriptor}`
								: placeholder
						);
					}

					return (
						`srcset=${quote}` +
						output.join(", ") +
						quote
					);
				}
			);

		return html;
	}

	/*
	 * ============================================================
	 * INLINE SCRIPTS
	 * ============================================================
	 */

	async processInlineScripts(
		html,
		htmlFile,
		context
	) {
		const regex =
			/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

		return await replaceMatchesAsync(
			html,
			regex,
			async (match) => {
				const attrs =
					match[1] || "";

				if (
					/\bdata-notelet-source=/i.test(
						attrs
					)
				) {
					return match[0];
				}

				let js =
					match[2] || "";

				const typeMatch =
					attrs.match(
						/\btype=["']([^"']+)["']/i
					);

				if (typeMatch) {
					const type =
						typeMatch[1]
							.toLowerCase();

					const allowed =
						type.includes(
							"javascript"
						) ||
						type === "module";

					if (!allowed) {
						return match[0];
					}
				}

				js =
					await this.processJavaScriptAssetStrings(
						js,
						htmlFile,
						context
					);

				return (
					`<script${attrs}>` +
					js +
					"</script>"
				);
			}
		);
	}

	/*
	 * ============================================================
	 * JS ASSET STRING MATCHING
	 * ============================================================
	 */

	async processJavaScriptAssetStrings(
		js,
		sourceFile,
		context
	) {
		const regex =
			new RegExp(
				`(["'\`])([^"'\\\`\\r\\n]+?\\.(?:${ASSET_EXTENSION_PATTERN}))(?:([?#][^"'\\\`\\r\\n]*))?\\1`,
				"gi"
			);

		return await replaceMatchesAsync(
			js,
			regex,
			async (match) => {
				const full =
					match[0];

				const quote =
					match[1];

				const resource =
					match[2];

				const suffix =
					match[3] || "";

				if (
					isExternalResource(
						resource
					)
				) {
					return full;
				}

				const placeholder =
					await this.importAssetReference(
						sourceFile,
						resource,
						context
					);

				if (!placeholder) {
					return full;
				}

				return (
					quote +
					placeholder +
					suffix +
					quote
				);
			}
		);
	}

	/*
	 * ============================================================
	 * IMPORT ASSET
	 * ============================================================
	 */

	async importAssetReference(
		sourceFile,
		resource,
		context
	) {
		const cleaned =
			cleanResourcePath(
				resource
			);

		if (!cleaned) {
			return null;
		}

		if (
			!looksLikeAssetPath(
				cleaned
			)
		) {
			return null;
		}

		const assetFile =
			resolveRelatedFile(
				sourceFile,
				cleaned,
				context.fileMap
			);

		if (!assetFile) {
			console.warn(
				`Notelets: Could not resolve asset: ${resource}`
			);

			return null;
		}

		return await this.copyAssetToVault(
			assetFile,
			context
		);
	}

	async copyAssetToVault(
		file,
		context
	) {
		const sourcePath =
			normalizeRelativePath(
				file.webkitRelativePath ||
					file.name
			);

		if (
			context.copiedAssets.has(
				sourcePath
			)
		) {
			return context.copiedAssets.get(
				sourcePath
			);
		}

		let relativePath =
			sourcePath;

		if (
			context.rootPrefix &&
			relativePath.startsWith(
				context.rootPrefix
			)
		) {
			relativePath =
				relativePath.slice(
					context.rootPrefix.length
				);
		}

		const safeRelativePath =
			sanitizeVaultRelativePath(
				relativePath
			);

		const vaultPath =
			normalizePath(
				`${context.assetRoot}/${safeRelativePath}`
			);

		const parent =
			getDirectoryPath(
				vaultPath
			).replace(
				/\/$/,
				""
			);

		if (parent) {
			await this.ensureFolderRecursive(
				parent
			);
		}

		const existing =
			this.app.vault
				.getAbstractFileByPath(
					vaultPath
				);

		if (!existing) {
			const buffer =
				await file.arrayBuffer();

			await this.app.vault.createBinary(
				vaultPath,
				buffer
			);
		}

		const placeholder =
			`notelet-asset://${encodeURIComponent(vaultPath)}`;

		context.copiedAssets.set(
			sourcePath,
			placeholder
		);

		return placeholder;
	}

	/*
	 * ============================================================
	 * CREATE NOTE
	 * ============================================================
	 */

	async createNoteletFile(
		notePath,
		html,
		sourceName,
		assetRoot,
		openInSourceMode
	) {
		const fence =
			createSafeFence(html);

		const frontmatter = [
			"---",
			"notelet: true",
			"notelet-version: 1",
		];

		if (sourceName) {
			frontmatter.push(
				`source-file: "${escapeYamlString(sourceName)}"`
			);

			frontmatter.push(
				`imported: "${new Date().toISOString()}"`
			);
		} else {
			frontmatter.push(
				`created: "${new Date().toISOString()}"`
			);
		}

		if (assetRoot) {
			frontmatter.push(
				`notelet-assets: "${escapeYamlString(assetRoot)}"`
			);
		}

		frontmatter.push(
			"---"
		);

		const markdown = [
			...frontmatter,
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
			this.app.workspace.getLeaf(
				false
			);

		await leaf.setViewState({
			type: "markdown",
			state: {
				file:
					createdFile.path,
				mode:
					openInSourceMode
						? "source"
						: "preview",
				source:
					Boolean(
						openInSourceMode
					),
			},
		});
	}

	/*
	 * ============================================================
	 * STORAGE
	 * ============================================================
	 */

	async handleNoteletMessage(event) {
		const message =
			event.data;

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

		this.noteletData.storage[
			noteletId
		] ??= {};

		switch (
			message.action
		) {
			case "set":
				this.noteletData.storage[
					noteletId
				][message.key] =
					String(
						message.value
					);

				break;

			case "remove":
				delete this.noteletData
					.storage[
						noteletId
					][message.key];

				break;

			case "clear":
				this.noteletData.storage[
					noteletId
				] = {};

				break;

			default:
				return;
		}

		await this.saveData(
			this.noteletData
		);
	}

	/*
	 * ============================================================
	 * FOLDER HELPERS
	 * ============================================================
	 */

	async ensureFolderRecursive(
		folderPath
	) {
		const normalized =
			normalizePath(
				folderPath
			);

		if (!normalized) {
			return;
		}

		const parts =
			normalized.split("/");

		let current = "";

		for (
			const part of parts
		) {
			current =
				current
					? `${current}/${part}`
					: part;

			const existing =
				this.app.vault
					.getAbstractFileByPath(
						current
					);

			if (!existing) {
				await this.app.vault
					.createFolder(
						current
					);
			}
		}
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
				!this.app.vault
					.getAbstractFileByPath(
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
 * ==============================================================
 * NOTELET RENDERER
 * ==============================================================
 */

class NoteletRenderChild extends MarkdownRenderChild {
	constructor(
		containerEl,
		html,
		noteletId,
		storage,
		app
	) {
		super(containerEl);

		this.html =
			html;

		this.noteletId =
			noteletId;

		this.storage =
			storage;

		this.app =
			app;

		this.iframe =
			null;
	}

	onload() {
		this.containerEl.empty();

		this.containerEl.addClass(
			"notelet-container"
		);

		this.iframe =
			document.createElement(
				"iframe"
			);

		this.iframe.addClass(
			"notelet-frame"
		);

		/*
		 * Resolve imported assets to Obsidian resource URLs.
		 */
		let renderedHtml =
			resolveNoteletAssetPlaceholders(
				this.html,
				this.app
			);

		/*
		 * Inject the localStorage bridge.
		 */
		renderedHtml =
			injectStorageBridge(
				renderedHtml,
				this.noteletId,
				this.storage
			);

		this.iframe.srcdoc =
			renderedHtml;

		/*
		 * IMPORTANT:
		 *
		 * allow-same-origin is deliberate.
		 *
		 * Notelets execute user-provided JavaScript, so they should
		 * only be created/imported from HTML the user trusts.
		 */
		this.iframe.setAttribute(
			"sandbox",
			[
				"allow-scripts",
				"allow-forms",
				"allow-modals",
				"allow-downloads",
				"allow-same-origin",
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
			this.iframe.srcdoc =
				"";

			this.iframe.remove();

			this.iframe =
				null;
		}
	}
}


/*
 * ==============================================================
 * ASSET RESOLUTION
 * ==============================================================
 */

function resolveNoteletAssetPlaceholders(
	html,
	app
) {
	const regex =
		/notelet-asset:\/\/([^"'`\s<>()]+)/g;

	return html.replace(
		regex,
		(full, encodedPath) => {
			let vaultPath;

			try {
				vaultPath =
					decodeURIComponent(
						encodedPath
					);
			} catch (error) {
				console.warn(
					"Notelets: Could not decode asset path:",
					encodedPath,
					error
				);

				return full;
			}

			const file =
				app.vault
					.getAbstractFileByPath(
						vaultPath
					);

			if (
				!(file instanceof TFile)
			) {
				console.warn(
					`Notelets: Missing imported asset: ${vaultPath}`
				);

				return full;
			}

			return app.vault
				.getResourcePath(
					file
				);
		}
	);
}


/*
 * ==============================================================
 * STORAGE SHIM
 * ==============================================================
 */

function injectStorageBridge(
	html,
	noteletId,
	storedValues
) {
	const safeId =
		JSON.stringify(
			noteletId
		);

	const safeStorage =
		JSON.stringify(
			storedValues || {}
		).replace(
			/</g,
			"\\u003c"
		);

	const bridge = `
<script data-notelets-storage>
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

	return injectImmediatelyAfterHead(
		html,
		bridge
	);
}


/*
 * ==============================================================
 * FILE RESOLUTION
 * ==============================================================
 */

function resolveRelatedFile(
	sourceFile,
	resourcePath,
	fileMap
) {
	const cleaned =
		cleanResourcePath(
			resourcePath
		);

	if (!cleaned) {
		return null;
	}

	const sourcePath =
		normalizeRelativePath(
			sourceFile.webkitRelativePath ||
				sourceFile.name
		);

	const sourceDirectory =
		getDirectoryPath(
			sourcePath
		);

	const resolved =
		resolvePath(
			sourceDirectory,
			cleaned
		);

	if (
		fileMap.has(
			resolved
		)
	) {
		return fileMap.get(
			resolved
		);
	}

	for (
		const [path, file]
		of fileMap
	) {
		if (
			decodeURIComponentSafe(
				path
			).toLowerCase() ===
			resolved.toLowerCase()
		) {
			return file;
		}
	}

	if (
		!cleaned.includes("/")
	) {
		const matches = [];

		for (
			const [, file]
			of fileMap
		) {
			if (
				file.name.toLowerCase() ===
				cleaned.toLowerCase()
			) {
				matches.push(
					file
				);
			}
		}

		if (
			matches.length === 1
		) {
			return matches[0];
		}

		if (
			matches.length > 1
		) {
			console.warn(
				`Notelets: Asset filename is ambiguous: ${cleaned}`
			);
		}
	}

	const suffixMatches = [];

	for (
		const [path, file]
		of fileMap
	) {
		if (
			path.toLowerCase()
				.endsWith(
					"/" +
					cleaned.toLowerCase()
				)
		) {
			suffixMatches.push(
				file
			);
		}
	}

	if (
		suffixMatches.length === 1
	) {
		return suffixMatches[0];
	}

	return null;
}


function resolvePath(
	baseDirectory,
	resource
) {
	const parts =
		`${baseDirectory}${resource}`
			.replace(
				/\\/g,
				"/"
			)
			.split("/");

	const resolved = [];

	for (
		const part of parts
	) {
		if (
			!part ||
			part === "."
		) {
			continue;
		}

		if (
			part === ".."
		) {
			if (
				resolved.length
			) {
				resolved.pop();
			}

			continue;
		}

		resolved.push(
			part
		);
	}

	return resolved.join("/");
}


function cleanResourcePath(
	value
) {
	let result =
		String(
			value || ""
		).trim();

	if (!result) {
		return "";
	}

	result =
		result
			.split("#")[0]
			.split("?")[0]
			.replace(
				/\\/g,
				"/"
			);

	result =
		decodeURIComponentSafe(
			result
		);

	while (
		result.startsWith(
			"./"
		)
	) {
		result =
			result.slice(2);
	}

	return result;
}


function normalizeRelativePath(
	path
) {
	return String(path)
		.replace(
			/\\/g,
			"/"
		)
		.replace(
			/^\/+/,
			""
		);
}


function getDirectoryPath(
	path
) {
	const normalized =
		normalizeRelativePath(
			path
		);

	const slash =
		normalized.lastIndexOf(
			"/"
		);

	if (
		slash === -1
	) {
		return "";
	}

	return normalized.slice(
		0,
		slash + 1
	);
}


function getRootPrefix(
	file
) {
	const path =
		normalizeRelativePath(
			file.webkitRelativePath ||
				""
		);

	if (!path) {
		return "";
	}

	const firstSlash =
		path.indexOf("/");

	if (
		firstSlash === -1
	) {
		return "";
	}

	return path.slice(
		0,
		firstSlash + 1
	);
}


/*
 * ==============================================================
 * ASSET HELPERS
 * ==============================================================
 */

function looksLikeAssetPath(
	value
) {
	const clean =
		cleanResourcePath(
			value
		);

	const regex =
		new RegExp(
			`\\.(?:${ASSET_EXTENSION_PATTERN})$`,
			"i"
		);

	return regex.test(
		clean
	);
}


function isExternalResource(
	value
) {
	const text =
		String(
			value || ""
		);

	return (
		/^[a-z][a-z0-9+.-]*:/i.test(
			text
		) ||
		text.startsWith(
			"//"
		) ||
		text.startsWith(
			"#"
		)
	);
}


function sanitizeVaultRelativePath(
	path
) {
	return normalizeRelativePath(
		path
	)
		.split("/")
		.filter(Boolean)
		.map(
			(segment) =>
				segment.replace(
					/[:*?"<>|]/g,
					"-"
				)
		)
		.join("/");
}


function getBasenameFromPath(
	path
) {
	const filename =
		path.split("/").pop() ||
		"Untitled Notelet.md";

	return filename.replace(
		/\.md$/i,
		""
	);
}


function decodeURIComponentSafe(
	value
) {
	try {
		return decodeURIComponent(
			value
		);
	} catch {
		return value;
	}
}


/*
 * ==============================================================
 * ASYNC REGEX REPLACEMENT
 * ==============================================================
 */

async function replaceMatchesAsync(
	text,
	regex,
	replacer
) {
	const matches =
		Array.from(
			text.matchAll(regex)
		);

	if (
		matches.length === 0
	) {
		return text;
	}

	const replacements =
		await Promise.all(
			matches.map(
				(match) =>
					replacer(
						match
					)
			)
		);

	let result = "";
	let cursor = 0;

	for (
		let i = 0;
		i < matches.length;
		i++
	) {
		const match =
			matches[i];

		const index =
			match.index;

		if (
			index === undefined
		) {
			continue;
		}

		result +=
			text.slice(
				cursor,
				index
			);

		result +=
			replacements[i];

		cursor =
			index +
			match[0].length;
	}

	result +=
		text.slice(
			cursor
		);

	return result;
}


/*
 * ==============================================================
 * HTML INJECTION
 * ==============================================================
 */

function injectImmediatelyAfterHead(
	html,
	content
) {
	if (
		/<head[^>]*>/i.test(
			html
		)
	) {
		return html.replace(
			/<head([^>]*)>/i,
			`<head$1>${content}`
		);
	}

	return (
		content +
		html
	);
}


/*
 * ==============================================================
 * GENERAL HELPERS
 * ==============================================================
 */

function removeHtmlExtension(
	filename
) {
	return filename.replace(
		/\.html?$/i,
		""
	);
}


function sanitizeFileName(
	filename
) {
	const sanitized =
		filename
			.replace(
				/[\\/:*?"<>|]/g,
				"-"
			)
			.replace(
				/\s+/g,
				" "
			)
			.trim();

	return (
		sanitized ||
		"Untitled Notelet"
	);
}


function escapeYamlString(
	value
) {
	return String(value)
		.replace(
			/\\/g,
			"\\\\"
		)
		.replace(
			/"/g,
			'\\"'
		);
}


function escapeHtmlAttribute(
	value
) {
	return String(value)
		.replace(
			/&/g,
			"&amp;"
		)
		.replace(
			/"/g,
			"&quot;"
		)
		.replace(
			/</g,
			"&lt;"
		)
		.replace(
			/>/g,
			"&gt;"
		);
}


function escapeHtmlText(
	value
) {
	return String(value)
		.replace(
			/&/g,
			"&amp;"
		)
		.replace(
			/</g,
			"&lt;"
		)
		.replace(
			/>/g,
			"&gt;"
		)
		.replace(
			/"/g,
			"&quot;"
		)
		.replace(
			/'/g,
			"&#039;"
		);
}


function createSafeFence(
	content
) {
	const matches =
		content.match(
			/`+/g
		);

	let longest = 2;

	if (matches) {
		for (
			const match of matches
		) {
			longest =
				Math.max(
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