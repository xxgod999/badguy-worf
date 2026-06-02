import {
	CameraSDK,
	Creep,
	CreepPathCorner,
	DotaMap,
	Entity,
	EntityManager,
	Hero,
	LocalPlayer,
	QAngle,
	Tower,
	Vector3
} from "github.com/octarine-public/wrapper/index"

import { MenuManager } from "./Menu"

export class MainManager {
	protected MyHero: Nullable<Hero>
	protected readonly CameraAngle = new QAngle(60, 90, 0)
	protected readonly CameraDistance = 1200

	constructor(protected readonly menu: MenuManager) {}

	public OnTick(_dt: number): void {
		if (!this.menu.State) {
			return
		}

		const hero = this.MyHero ?? LocalPlayer?.Hero
		if (hero === undefined || !hero.IsAlive || !hero.IsSpawned) {
			return
		}

		this.MyHero = hero
		this.ProcessAutoPush(hero)
	}

	public OnDraw(): void {
		if (!this.menu.State) {
			return
		}

		const hero = this.MyHero ?? LocalPlayer?.Hero
		if (hero === undefined || !hero.IsAlive || !hero.IsSpawned) {
			return
		}

		this.MyHero = hero
		this.LockCamera(hero)
	}

	public OnGameEnded(): void {
		this.MyHero = undefined
	}

	public OnGameStarted(): void {
		this.MyHero = LocalPlayer?.Hero
	}

	public OnEntityCreated(entity: Entity): void {
		if (entity instanceof Hero && entity.IsMyHero) {
			this.MyHero = entity
		}
	}

	public OnEntityDestroyed(entity: Entity): void {
		if (this.MyHero === entity) {
			this.MyHero = undefined
		}
	}

	protected LockCamera(hero: Hero): void {
		hero.Position.toIOBuffer()
		Camera.Position = true
		CameraSDK.Angles = this.CameraAngle
		CameraSDK.Distance = this.CameraDistance
	}

	protected ProcessAutoPush(hero: Hero): void {
		const lane = this.menu.Lane
		const laneCreeps = this.GetLaneCreeps(
			EntityManager.GetEntitiesByClass(Creep),
			lane
		)

		const lastHitTarget = this.FindLastHitTarget(hero, laneCreeps)
		if (lastHitTarget !== undefined) {
			hero.AttackTarget(lastHitTarget)
			return
		}

		const nearestEnemy = this.GetNearestEnemyHero(
			hero,
			EntityManager.GetEntitiesByClass(Hero)
		)
		if (
			nearestEnemy !== undefined &&
			nearestEnemy.Distance2D(hero) < this.menu.EnemyDistance
		) {
			this.RetreatFrom(hero, nearestEnemy.Position)
			return
		}

		const towers = EntityManager.GetEntitiesByClass(Tower)
		if (this.IsInTowerRange(hero, towers)) {
			this.MoveToSafePosition(
				hero,
				DotaMap.GetCreepCurrentTarget(hero.Position, hero.Team, lane),
				towers
			)
			return
		}

		this.PositionNearCreeps(
			hero,
			laneCreeps,
			DotaMap.GetCreepCurrentTarget(hero.Position, hero.Team, lane)
		)
	}

	protected GetLaneCreeps(creeps: Creep[], lane: number): Creep[] {
		const result: Creep[] = []
		for (let i = 0; i < creeps.length; i++) {
			const creep = creeps[i]
			if (creep.IsSpawned && creep.IsAlive && creep.Lane === lane) {
				result.push(creep)
			}
		}
		return result
	}

	protected FindLastHitTarget(hero: Hero, laneCreeps: Creep[]): Nullable<Creep> {
		let bestTarget: Nullable<Creep>
		let bestHP = Infinity

		for (let i = 0; i < laneCreeps.length; i++) {
			const creep = laneCreeps[i]
			if (!creep.IsEnemy(hero) || !hero.CanAttack(creep)) {
				continue
			}

			const rawDamage = hero.GetRawAttackDamage(creep)
			if (rawDamage <= 0) {
				continue
			}

			let adjustedHP = creep.HP
			if (hero.IsRanged) {
				const projectileTime = hero.Distance2D(creep) / 1200
				adjustedHP = creep.HP - 40 * projectileTime
			}

			if (rawDamage >= adjustedHP && adjustedHP < bestHP) {
				bestHP = adjustedHP
				bestTarget = creep
			}
		}
		return bestTarget
	}

	protected GetNearestEnemyHero(hero: Hero, heroes: Hero[]): Nullable<Hero> {
		let nearest: Nullable<Hero>
		let minDist = Infinity

		for (let i = 0; i < heroes.length; i++) {
			const enemy = heroes[i]
			if (
				enemy === hero ||
				!enemy.IsEnemy(hero) ||
				!enemy.IsAlive ||
				!enemy.IsSpawned
			) {
				continue
			}

			const dist = enemy.Distance2D(hero)
			if (dist < minDist) {
				minDist = dist
				nearest = enemy
			}
		}
		return nearest
	}

	protected RetreatFrom(hero: Hero, threatPosition: Vector3): void {
		const direction = hero.Position
			.Clone()
			.SubtractForThis(threatPosition)
			.SetZ(0)
			.Normalize()
			.MultiplyScalarForThis(400)

		hero.MoveTo(hero.Position.Clone().AddForThis(direction))
	}

	protected IsInTowerRange(hero: Hero, towers: Tower[]): boolean {
		for (let i = 0; i < towers.length; i++) {
			const tower = towers[i]
			if (!tower.IsAlive || !tower.IsSpawned || !tower.IsEnemy(hero)) {
				continue
			}

			if (tower.Distance2D(hero) <= tower.GetAttackRange(hero, 100)) {
				return true
			}
		}
		return false
	}

	protected MoveToSafePosition(
		hero: Hero,
		nextCorner: Nullable<CreepPathCorner>,
		towers: Tower[]
	): void {
		if (nextCorner !== undefined && nextCorner.Referencing.size > 0) {
			const previousCorners = [...nextCorner.Referencing]
			hero.MoveTo(previousCorners[0].Position)
			return
		}

		let nearestBuilding: Nullable<Tower>
		let minDist = Infinity
		for (let i = 0; i < towers.length; i++) {
			const tower = towers[i]
			if (tower.IsEnemy(hero) || !tower.IsAlive || !tower.IsSpawned) {
				continue
			}

			const dist = tower.Distance2D(hero)
			if (dist < minDist) {
				minDist = dist
				nearestBuilding = tower
			}
		}

		if (nearestBuilding !== undefined) {
			hero.MoveTo(nearestBuilding.Position)
		}
	}

	protected PositionNearCreeps(
		hero: Hero,
		laneCreeps: Creep[],
		nextCorner: Nullable<CreepPathCorner>
	): void {
		const targetDist = this.menu.CreepDistance
		let nearestFriendly: Nullable<Creep>
		let minDist = Infinity

		for (let i = 0; i < laneCreeps.length; i++) {
			const creep = laneCreeps[i]
			if (creep.IsEnemy(hero)) {
				continue
			}

			const dist = creep.Distance2D(hero)
			if (dist < minDist) {
				minDist = dist
				nearestFriendly = creep
			}
		}

		if (nearestFriendly === undefined) {
			if (nextCorner !== undefined) {
				hero.MoveTo(nextCorner.Position)
			}
			return
		}

		if (minDist > targetDist + 50) {
			hero.MoveTo(nearestFriendly.Position)
			return
		}

		if (minDist < targetDist - 50) {
			const awayDirection = hero.Position
				.Clone()
				.SubtractForThis(nearestFriendly.Position)
				.SetZ(0)
				.Normalize()
				.MultiplyScalarForThis(200)

			hero.MoveTo(hero.Position.Clone().AddForThis(awayDirection))
			return
		}

		if (nextCorner !== undefined) {
			hero.MoveTo(nextCorner.Position)
		}
	}
}
