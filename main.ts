import {
	MarkdownRenderChild,
	Notice,
	Plugin,
	normalizePath,
} from "obsidian";

const NOTELET_LANGUAGE = "notelet";
const NOTELETS_FOLDER = "Notelets";

export default class NoteletsPlugin extends Plugin {
	async onload() {
		console.log("Loading Notelets");

		/*
		 * Render ```notelet blocks as sandboxed iframes.
		 */
		this.registerMarkdownCodeBlockProcessor(
			NOTELET_LANGUAGE,
			(source, el, ctx) => {
				const child = new NoteletRenderChild(el, source);
				ctx.addChild(child);
			}
		);

		/*
		 * Command: Import an HTML file as a Notelet.
		 */
		this.addCommand({
			id: "import-html-as-notelet",
			name: "Import HTML as Notelet",
			callback: () => {
				void this.importHtmlFile();
			},
		});

		/*
		 * Ribbon button.
		 */
		this.addRibbonIcon(
			"file-code-2",
			"Import HTML as Notelet",
			() => {
				void this.importHtmlFile();
			}
		);
	}

	private async importHtmlFile(): Promise<void> {
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

				void this.createNoteletFromFile(file);
			},
			{ once: true }
		);

		input.click();
	}

	private async createNoteletFromFile(file: File): Promise<void> {
		try {
			const html = await file.text();

			if (!html.trim()) {
				new Notice("The selected HTML file is empty.");
				return;
			}

			await this.ensureFolder(NOTELETS_FOLDER);

			const originalName = removeHtmlExtension(file.name);
			const safeName = sanitizeFileName(originalName);

			const notePath = await this.getAvailableNotePath(
				NOTELETS_FOLDER,
				safeName
			);

			const fence = createSafeFence(html);

			const markdown = [
				"---",
				"notelet: true",
				"notelet-version: 1",
				`source-file: "${escapeYamlString(file.name)}"`,
				`imported: "${new Date().toISOString()}"`,
				"---",
				"",
				`${fence}${NOTELET_LANGUAGE}`,
				html,
				fence,
				"",
			].join("\n");

			const createdFile = await this.app.vault.create(
				notePath,
				markdown
			);

			new Notice(`Created Notelet: ${createdFile.basename}`);

			/*
			 * Open immediately in Reading mode so the Notelet renders.
			 */
			const leaf = this.app.workspace.getLeaf(false);

			await leaf.setViewState({
				type: "markdown",
				state: {
					file: createdFile.path,
					mode: "preview",
					source: false,
				},
			});
		} catch (error) {
			console.error("Notelet import failed:", error);

			new Notice(
				"Could not create the Notelet. Check the developer console for details."
			);
		}
	}

	private async ensureFolder(folderPath: string): Promise<void> {
		const normalized = normalizePath(folderPath);

		if (this.app.vault.getAbstractFileByPath(normalized)) {
			return;
		}

		await this.app.vault.createFolder(normalized);
	}

	private async getAvailableNotePath(
		folder: string,
		baseName: string
	): Promise<string> {
		let counter = 0;

		while (true) {
			const suffix = counter === 0 ? "" : ` ${counter}`;

			const path = normalizePath(
				`${folder}/${baseName}${suffix}.md`
			);

			if (!this.app.vault.getAbstractFileByPath(path)) {
				return path;
			}

			counter++;
		}
	}
}

class NoteletRenderChild extends MarkdownRenderChild {
	private iframe: HTMLIFrameElement | null = null;

	constructor(
		containerEl: HTMLElement,
		private readonly html: string
	) {
		super(containerEl);
	}

	onload(): void {
		this.containerEl.empty();
		this.containerEl.addClass("notelet-container");

		this.iframe = document.createElement("iframe");

		this.iframe.addClass("notelet-frame");

		/*
		 * The HTML stored directly inside the Markdown note becomes
		 * the iframe document.
		 */
		this.iframe.srcdoc = this.html;

		/*
		 * Keep Notelet JavaScript isolated from Obsidian itself.
		 *
		 * Deliberately omit allow-same-origin.
		 */
		this.iframe.setAttribute(
			"sandbox",
			"allow-scripts allow-forms allow-modals allow-downloads"
		);

		this.iframe.setAttribute(
			"title",
			"Notelet"
		);

		this.containerEl.appendChild(this.iframe);
	}

	onunload(): void {
		if (this.iframe) {
			this.iframe.srcdoc = "";
			this.iframe.remove();
			this.iframe = null;
		}
	}
}

function removeHtmlExtension(filename: string): string {
	return filename.replace(/\.html?$/i, "");
}

function sanitizeFileName(filename: string): string {
	const sanitized = filename
		.replace(/[\\/:*?"<>|]/g, "-")
		.replace(/\s+/g, " ")
		.trim();

	return sanitized || "Untitled Notelet";
}

function escapeYamlString(value: string): string {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"');
}

/*
 * Choose a Markdown fence longer than any sequence of backticks
 * that already exists inside the imported HTML.
 */
function createSafeFence(content: string): string {
	const matches = content.match(/`+/g);

	let longest = 2;

	if (matches) {
		for (const match of matches) {
			longest = Math.max(longest, match.length);
		}
	}

	return "`".repeat(Math.max(3, longest + 1));
}