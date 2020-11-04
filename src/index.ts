/* CSCI 5619 Lecture 16, Fall 2020
 * Author: Evan Suma Rosenberg
 * License: Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International
 */ 

import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3, Color3, Space } from "@babylonjs/core/Maths/math";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { WebXRControllerComponent } from "@babylonjs/core/XR/motionController/webXRControllercomponent";
import { WebXRInputSource } from "@babylonjs/core/XR/webXRInputSource";
import { WebXRCamera } from "@babylonjs/core/XR/webXRCamera";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Logger } from "@babylonjs/core/Misc/logger";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import {MeshBuilder} from  "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import { Ray } from "@babylonjs/core/Culling/ray";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";

// Side effects
import "@babylonjs/core/Helpers/sceneHelpers";
import "@babylonjs/inspector";
import { Axis } from "@babylonjs/core/Maths/math.axis";


enum LocomotionMode
{
    viewDirected,
    handDirected,
    teleportation
}

class Game 
{ 
    private canvas: HTMLCanvasElement;
    private engine: Engine;
    private scene: Scene;

    private xrCamera: WebXRCamera | null; 
    private leftController: WebXRInputSource | null;
    private rightController: WebXRInputSource | null;

    private locomotionMode: LocomotionMode;
    private laserPointer: LinesMesh | null;
    private groundMeshes: Array<AbstractMesh>;
    private teleportPoint: Vector3 | null;
    
    constructor()
    {
        // Get the canvas element 
        this.canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;

        // Generate the BABYLON 3D engine
        this.engine = new Engine(this.canvas, true); 

        // Creates a basic Babylon Scene object
        this.scene = new Scene(this.engine);   

        this.xrCamera = null;
        this.leftController = null;
        this.rightController = null;
        
        this.locomotionMode = LocomotionMode.viewDirected;
        this.laserPointer = null;
        this.groundMeshes = [];
        this.teleportPoint = null;
    }

    start() : void 
    {
        // Create the scene and then execute this function afterwards
        this.createScene().then(() => {

            // Register a render loop to repeatedly render the scene
            this.engine.runRenderLoop(() => { 
                this.update();
                this.scene.render();
            });

            // Watch for browser/canvas resize events
            window.addEventListener("resize", () => { 
                this.engine.resize();
            });
        });
    }

    private async createScene() 
    {
        // This creates and positions a first-person camera (non-mesh)
        var camera = new UniversalCamera("camera1", new Vector3(0, 1.6, 0), this.scene);
        camera.fov = 90 * Math.PI / 180;
        camera.minZ = .1;
        camera.maxZ = 100;

        // This attaches the camera to the canvas
        camera.attachControl(this.canvas, true);

       // Create a point light
       var pointLight = new PointLight("pointLight", new Vector3(0, 2.5, 0), this.scene);
       pointLight.intensity = 1.0;
       pointLight.diffuse = new Color3(.25, .25, .25);

        // Creates a default skybox
        const environment = this.scene.createDefaultEnvironment({
            createGround: true,
            groundSize: 100,
            skyboxSize: 100,
            skyboxColor: new Color3(0, 0, 0)
        });

        // Make sure the skybox is not pickable!
        environment!.skybox!.isPickable = false;

        // The ground should be pickable for teleportation
        environment!.ground!.isPickable = true;
        this.groundMeshes.push(environment!.ground!);

        // Creates the XR experience helper
        const xrHelper = await this.scene.createDefaultXRExperienceAsync({});

        // Assigns the web XR camera to a member variable
        this.xrCamera = xrHelper.baseExperience.camera;

        // Remove default teleportation and pointer selection
        xrHelper.teleportation.dispose();
        xrHelper.pointerSelection.dispose();

        // Create points for the laser pointer
        var laserPoints = [];
        laserPoints.push(new Vector3(0, 0, 0));
        laserPoints.push(new Vector3(0, 0, 1));

        // Create a laser pointer and make sure it is not pickable
        this.laserPointer = MeshBuilder.CreateLines("laserPointer", {points: laserPoints}, this.scene);
        this.laserPointer.color = Color3.White();
        this.laserPointer.alpha = .5;
        this.laserPointer.visibility = 0;
        this.laserPointer.isPickable = false;

        // Attach the laser pointer to the right controller when it is connected
        xrHelper.input.onControllerAddedObservable.add((inputSource) => {
            if(inputSource.uniqueId.endsWith("right"))
            {
                this.rightController = inputSource;
                this.laserPointer!.parent = this.rightController.pointer;
            }
            else 
            {
                this.leftController = inputSource;
            }  
        });

        // Don't forget to deparent the laser pointer or it will be destroyed!
        xrHelper.input.onControllerRemovedObservable.add((inputSource) => {

            if(inputSource.uniqueId.endsWith("right")) 
            {
                this.laserPointer!.parent = null;
                this.laserPointer!.visibility = 0;
            }
        });

        // Create a blue emissive material
        var blueMaterial = new StandardMaterial("blueMaterial", this.scene);
        blueMaterial.diffuseColor = new Color3(.284, .73, .831);
        blueMaterial.specularColor = Color3.Black();
        blueMaterial.emissiveColor = new Color3(.284, .73, .831);

        // Create a column at a convenient place
        var column = MeshBuilder.CreateBox("column", {width: 1, depth: 1, height: 3}, this.scene);
        column.position = new Vector3(0, 1.5, 10);
        column.material = blueMaterial;

        // Create a simple locomotion testbed
        for (let i=0; i < 50; i++)
        {
            let columnInstance = column.createInstance("column");
            columnInstance.position = new Vector3(Math.random() * 30 - 15, 1.5, Math.random() * 30 - 15);
        }
        
        this.scene.debugLayer.show(); 
    }

    // The main update loop will be executed once per frame before the scene is rendered
    private update() : void
    {
        // Polling for controller input
        this.processControllerInput();  
    }

    // Process event handlers for controller input
    private processControllerInput()
    {
        this.onRightA(this.rightController?.motionController?.getComponent("a-button"));
        this.onRightThumbstick(this.rightController?.motionController?.getComponent("xr-standard-thumbstick"));    
    }

    private onRightThumbstick(component?: WebXRControllerComponent)
    {
        // If we have an object that is currently attached to the laser pointer
        if(component?.changes.axes)
        {
            // If the thumbstick is moved forward
            if(component.axes.y < 0)
            {
                // View-directed steering
                if(this.locomotionMode == LocomotionMode.viewDirected)
                {
                    // Get the current camera direction
                    var directionVector = this.xrCamera!.getDirection(Axis.Z);

                    // Use delta time to calculate the move distance based on speed of 3 m/s
                    var moveDistance = -component.axes.y * (this.engine.getDeltaTime() / 1000) * 3;
                    
                    // Translate the camera forward
                    this.xrCamera!.position.addInPlace(directionVector.scale(moveDistance));
                }
                // Hand-directed steering
                else if(this.locomotionMode == LocomotionMode.handDirected)
                {
                    // Get the current hand directon
                    var directionVector = this.rightController!.pointer.forward;

                    // Use delta time to calculate the move distance based on speed of 3 m/s
                    var moveDistance = -component.axes.y * (this.engine.getDeltaTime() / 1000) * 3;
                    
                    // Translate the camera in the direction of the hand
                    this.xrCamera!.position.addInPlace(directionVector.scale(moveDistance));
                }
                // Teleportation
                else
                {
                    // Create a new ray cast
                    var ray = new Ray(this.rightController!.pointer.position, this.rightController!.pointer.forward, 20);
                    var pickInfo = this.scene.pickWithRay(ray);

                    // If we intersected a ground mesh
                    if(pickInfo?.hit && this.groundMeshes.includes(pickInfo.pickedMesh!))
                    {
                        this.teleportPoint = pickInfo.pickedPoint!;
                        this.laserPointer!.scaling.z = pickInfo.distance;
                        this.laserPointer!.visibility = 1;
                    }      
                    else
                    {
                        this.teleportPoint = null;
                        this.laserPointer!.visibility = 0;
                    }              
                }
            }
            // If the thumbstick returns to rest and we have a valid teleport point
            else if(component.axes.y == 0 && this.teleportPoint)
            {
                this.xrCamera!.position.x = this.teleportPoint.x;
                this.xrCamera!.position.y = this.teleportPoint.y + this.xrCamera!.realWorldHeight;
                this.xrCamera!.position.z = this.teleportPoint.z;
                this.teleportPoint = null;
                this.laserPointer!.visibility = 0;
            }
        }
    }

    private onRightA(component?: WebXRControllerComponent)
    {  
        if(component?.changes.pressed?.current)
        {
            if(this.locomotionMode == LocomotionMode.teleportation)
            {
                this.locomotionMode = 0;
            }
            else
            {
                this.locomotionMode += 1;
            }
        }  
    }
}
/******* End of the Game class ******/   

// start the game
var game = new Game();
game.start();