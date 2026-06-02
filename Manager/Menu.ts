import { MapArea, Menu } from "github.com/octarine-public/wrapper/index"

export class MenuManager {
	protected readonly Entries: Menu.Node
	protected readonly Menu: Menu.Node
	protected readonly IState: Menu.Toggle
	protected readonly ILane: Menu.Dropdown
	protected readonly ICreepDistance: Menu.Slider
	protected readonly IEnemyDistance: Menu.Slider

	constructor() {
		this.Entries = Menu.AddEntry("Utility")
		this.Menu = this.Entries.AddNode(
			"Worf Script",
			"panorama/images/hud/reborn/icon_damage_psd.vtex_c"
		)
		this.IState = this.Menu.AddToggle("Enabled", true)
		this.ILane = this.Menu.AddDropdown(
			"Lane",
			["Top", "Middle", "Bottom"],
			1,
			"Select lane to auto-push"
		)
		this.ICreepDistance = this.Menu.AddSlider(
			"Creep distance",
			300,
			0,
			2000,
			0,
			"Target distance from friendly creeps"
		)
		this.IEnemyDistance = this.Menu.AddSlider(
			"Enemy distance",
			300,
			0,
			2000,
			0,
			"Minimum safe distance from enemy heroes"
		)
	}

	public get State(): boolean {
		return this.IState.value
	}

	public get Lane(): MapArea {
		return (this.ILane.SelectedID + 1) as MapArea
	}

	public get CreepDistance(): number {
		return this.ICreepDistance.value
	}

	public get EnemyDistance(): number {
		return this.IEnemyDistance.value
	}
}
