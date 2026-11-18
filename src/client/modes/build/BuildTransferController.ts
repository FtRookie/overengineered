import { HttpService } from "@rbxts/services";
import { TextPopup } from "client/gui/popup/TextPopup";
import { LogControl } from "client/gui/static/LogControl";
import { reGenerateUuids } from "client/tools/EditTool";
import { Component } from "engine/shared/component/Component";
import { Element } from "engine/shared/Element";
import { Strings } from "engine/shared/fixes/String.propmacro";
import { BlocksSerializer } from "shared/building/BlocksSerializer";
import { Colors } from "shared/Colors";
import { GameDefinitions } from "shared/data/GameDefinitions";
import type { MainScreenLayout } from "client/gui/MainScreenLayout";
import type { PopupController } from "client/gui/PopupController";
import type { ClientBuilding } from "client/modes/build/ClientBuilding";
import type { PlaceBlockRequestWithUuid } from "client/tools/EditTool";
import type { LatestSerializedBlock } from "shared/building/BlocksSerializer";
import type { SharedPlot } from "shared/building/SharedPlot";

/** Drawn rather than an uploaded image, so the buttons need no asset of their own. */
namespace TopRightIcon {
	const shape = (parent: GuiObject, name: string, position: UDim2, size: UDim2, color: Color3): Frame => {
		const frame = Element.create("Frame", {
			Name: name,
			Position: position,
			Size: size,
			BackgroundColor3: color,
			BorderSizePixel: 0,
			Parent: parent,
		});
		Element.create("UICorner", { CornerRadius: new UDim(0.14, 0), Parent: frame });

		return frame;
	};

	export function copy(label: ImageLabel) {
		label.Image = "";
		shape(label, "Back", UDim2.fromScale(0.08, 0.08), UDim2.fromScale(0.52, 0.52), Colors.white);

		const front = shape(label, "Front", UDim2.fromScale(0.4, 0.4), UDim2.fromScale(0.52, 0.52), Colors.white);
		Element.create("UIStroke", {
			Color: Colors.black,
			Thickness: 1.5,
			ApplyStrokeMode: Enum.ApplyStrokeMode.Border,
			Parent: front,
		});
	}

	export function paste(label: ImageLabel) {
		label.Image = "";
		shape(label, "Body", UDim2.fromScale(0.18, 0.2), UDim2.fromScale(0.64, 0.72), Colors.white);
		shape(label, "Clip", UDim2.fromScale(0.34, 0.04), UDim2.fromScale(0.32, 0.18), Colors.white);
		shape(label, "Page", UDim2.fromScale(0.28, 0.33), UDim2.fromScale(0.44, 0.5), Color3.fromRGB(4, 8, 16));
		shape(label, "Line1", UDim2.fromScale(0.35, 0.44), UDim2.fromScale(0.3, 0.06), Colors.white);
		shape(label, "Line2", UDim2.fromScale(0.35, 0.56), UDim2.fromScale(0.3, 0.06), Colors.white);
	}
}

/** Falls after every button registered by the other controllers, so the pair ends the grid. */
const TOP_RIGHT_ORDER = 997;

/** Text is shared by hand, so it travels as base64 of a Zstd frame rather than raw JSON. */
namespace BuildText {
	const prefix = "OE1:";
	/** The decompressor allocates whatever size the frame declares, so refuse anything larger than a save. */
	const maxInflated = 33_554_432;

	const service = () => game.GetService("EncodingService");

	export function encode(json: string): string {
		const encoding = service();
		const blob = encoding.CompressBuffer(buffer.fromstring(json), Enum.CompressionAlgorithm.Zstd, 1);

		return prefix + buffer.tostring(encoding.Base64Encode(blob));
	}

	export function toJson(text: string): string {
		if (!text.startsWith(prefix)) {
			if (!text.startsWith("{")) throw "that text is not a build";
			return text;
		}

		const encoding = service();
		const payload = text.sub(prefix.size() + 1).gsub("%s", "")[0];
		const blob = encoding.Base64Decode(buffer.fromstring(payload));
		const size = encoding.GetDecompressedBufferSize(blob, Enum.CompressionAlgorithm.Zstd);
		if (size === undefined || size > maxInflated) throw `the build text declares ${size ?? "no"} bytes`;

		return buffer.tostring(encoding.DecompressBuffer(blob, Enum.CompressionAlgorithm.Zstd));
	}
}

/** Copies the plot's build into shareable text and places a build back from such text. */
@injectable
export class BuildTransferController extends Component {
	constructor(
		@inject mainScreen: MainScreenLayout,
		@inject private readonly plot: SharedPlot,
		@inject private readonly clientBuilding: ClientBuilding,
		@inject private readonly blockList: BlockList,
		@inject private readonly popupController: PopupController,
	) {
		super();

		const copyButton = this.parentGui(mainScreen.addTopRightButton("CopyBuild")) //
			.subscribeVisibilityFrom({ main_enabled: this.enabledState })
			.addButtonAction(() => this.copyToText());
		TopRightIcon.copy(copyButton.instance.ImageLabel);
		copyButton.instance.LayoutOrder = TOP_RIGHT_ORDER;

		const pasteButton = this.parentGui(mainScreen.addTopRightButton("PasteBuild")) //
			.subscribeVisibilityFrom({ main_enabled: this.enabledState })
			.addButtonAction(() => this.askForText());
		TopRightIcon.paste(pasteButton.instance.ImageLabel);
		pasteButton.instance.LayoutOrder = TOP_RIGHT_ORDER + 1;
	}

	private copyToText() {
		const blocks = BlocksSerializer.objectToJson(BlocksSerializer.serializeToObject(this.plot));
		const json = HttpService.JSONEncode(blocks);
		const text = BuildText.encode(json);

		this.popupController.showPopup(
			new TextPopup(
				`COPY BUILD — ${blocks.blocks.size()} BLOCKS`,
				"",
				() => {},
				() => {},
				text,
			),
		);

		LogControl.instance.addLine(
			`Copied ${blocks.blocks.size()} blocks (${Strings.prettyKMT(json.size())} characters of JSON, shared as ${text.size()}). Press Ctrl+C to take the text.`,
		);
	}

	private askForText() {
		this.popupController.showPopup(
			new TextPopup(
				"PASTE BUILD",
				"Paste the build text here",
				(text) => this.placeFromText(text),
				() => {},
			),
		);
	}

	private placeFromText(raw: string) {
		const text = raw.trim();
		if (text === "") return;

		const [unpackOk, json] = pcall(() => BuildText.toJson(text));
		if (!unpackOk) {
			this.reportError(`Could not read the build: ${tostring(json)}`);
			return;
		}
		if (json.size() > GameDefinitions.SLOT_SIZE_CAP) {
			this.reportError("That build is too big to be saved");
			return;
		}

		const [decodedOk, decoded] = pcall(() => HttpService.JSONDecode(json));
		if (!decodedOk || !typeIs(decoded, "table")) {
			this.reportError("That text is not a build");
			return;
		}

		const version = (decoded as { readonly version?: unknown }).version;
		const serializedBlocks = (decoded as { readonly blocks?: unknown }).blocks;
		if (!typeIs(version, "number") || !typeIs(serializedBlocks, "table")) {
			this.reportError("That text is not a build");
			return;
		}
		if (version > BlocksSerializer.latestVersion) {
			this.reportError("This build was made in a newer version of the game");
			return;
		}

		const [parseOk, requests] = pcall(() => this.toPlaceRequests(decoded as BlocksSerializer.JsonSerializedBlocks));
		if (!parseOk) {
			this.reportError(`Could not read the build: ${tostring(requests)}`);
			return;
		}

		const response = this.clientBuilding.placeOperation.execute({ plot: this.plot, blocks: requests });
		if (!response.success) {
			this.reportError(response.message);
			return;
		}

		LogControl.instance.addLine(`Pasted ${requests.size()} blocks`);
	}

	private toPlaceRequests(data: BlocksSerializer.JsonSerializedBlocks): readonly PlaceBlockRequestWithUuid[] {
		const upgraded = BlocksSerializer.upgradeSave(BlocksSerializer.jsonToObject(data), this.blockList);
		const blocks = upgraded.blocks as readonly LatestSerializedBlock[];

		const unknown = blocks
			.filter((block) => this.blockList.blocks[block.id] === undefined)
			.map((block) => block.id);
		if (unknown.size() > 0) {
			throw `this build uses blocks that do not exist: ${unknown.join(", ")}`;
		}

		const requests: readonly PlaceBlockRequestWithUuid[] = blocks.map((block) => ({
			...BlocksSerializer.serializedBlockToPlaceRequest(block, this.plot.origin),
			uuid: (block.uuid ?? HttpService.GenerateGUID(false)) as BlockUuid,
		}));

		return reGenerateUuids(this.plot, requests);
	}

	private reportError(message: string) {
		LogControl.instance.addLine(message, Colors.red);
	}
}
