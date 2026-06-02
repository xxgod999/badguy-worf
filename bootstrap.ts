import { EventsSDK } from "github.com/octarine-public/wrapper/index"

import { MainManager } from "./Manager/Main"
import { MenuManager } from "./Manager/Menu"

const IMenu = new MenuManager()
const IManager = new MainManager(IMenu)

EventsSDK.on("Tick", dt => IManager.OnTick(dt))

EventsSDK.on("GameEnded", () => IManager.OnGameEnded())

EventsSDK.on("GameStarted", () => IManager.OnGameStarted())

EventsSDK.on("EntityCreated", entity => IManager.OnEntityCreated(entity))

EventsSDK.on("EntityDestroyed", entity => IManager.OnEntityDestroyed(entity))
