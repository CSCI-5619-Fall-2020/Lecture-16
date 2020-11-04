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
import { Axis } from "@babylonjs/core/Maths/math.axis";
import { Quaternion } from "@babylonjs/core/Maths/math.vector";

// Side effects
import "@babylonjs/core/Helpers/sceneHelpers";
import "@babylonjs/inspector";

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
            skyboxSize: 50,
            skyboxColor: new Color3(0, 0, 0)
        });

        // Make sure the skybox is not pickable!
        environment!.skybox!.isPickable = false;

        // The ground should be pickable for teleportation
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
        var column = MeshBuilder.CreateBox("column", {width: 2, depth: 2, height: 5}, this.scene);
        column.position = new Vector3(0, 2.5, 10);
        column.material = blueMaterial;

        // Create a simple locomotion testbed
        for (let i=0; i < 30; i++)
        {
            let columnInstance = column.createInstance("column");
            columnInstance.position = new Vector3(Math.random() * 25 - 12.5, 2.5, Math.random() * 25 - 12.5);
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
        if(component?.changes.axes)
        {
            // View-directed steering
            if(this.locomotionMode == LocomotionMode.viewDirected)
            {
                // Get the current camera direction
                var directionVector = this.xrCamera!.getDirection(Axis.Z);

                // Use delta time to calculate the move distance based on speed of 3 m/sec
                var moveDistance = -component.axes.y * (this.engine.getDeltaTime() / 1000) * 3;

                // Translate the camera forward
                this.xrCamera!.position.addInPlace(directionVector.scale(moveDistance));

                // Use delta time to calculate the turn angle based on speed of 60 degrees/sec
                var turnAngle = component.axes.x * (this.engine.getDeltaTime() / 1000) * 60;

                // Smooth turning
                var cameraRotation = Quaternion.FromEulerAngles(0, turnAngle * Math.PI / 180, 0);
                this.xrCamera!.rotationQuaternion.multiplyInPlace(cameraRotation);
            }
            else if(this.locomotionMode == LocomotionMode.handDirected)
            {
                // Get the current hand direction
                var directionVector = this.rightController!.pointer.forward;

                // Use delta time to calculate the move distance based on speed of 3 m/sec
                var moveDistance = -component.axes.y * (this.engine.getDeltaTime() / 1000) * 3;

                // Translate the camera forward
                this.xrCamera!.position.addInPlace(directionVector.scale(moveDistance));

                // Use delta time to calculate the turn angle based on speed of 60 degrees/sec
                var turnAngle = component.axes.x * (this.engine.getDeltaTime() / 1000) * 60;

                // Smooth turning
                var cameraRotation = Quaternion.FromEulerAngles(0, turnAngle * Math.PI / 180, 0);
                this.xrCamera!.rotationQuaternion.multiplyInPlace(cameraRotation);
            }
            // Teleportation
            else
            {
                // If the thumbstick is moved forward
                if(component.axes.y < -.75)
                {
                    // Create a new ray cast
                    var ray = new Ray(this.rightController!.pointer.position, this.rightController!.pointer.forward, 20);
                    var pickInfo = this.scene.pickWithRay(ray);

                    // If the ray cast intersected a ground mesh
                    if(pickInfo?.hit && this.groundMeshes.includes(pickInfo.pickedMesh!))
                    {
                        this.teleportPoint = pickInfo.pickedPoint;
                        this.laserPointer!.scaling.z = pickInfo.distance;
                        this.laserPointer!.visibility = 1;
                    }
                    else
                    {
                        this.teleportPoint = null;
                        this.laserPointer!.visibility = 0;
                    }
                }
                // If thumbstick returns to the rest position
                else if(component.axes.y == 0)
                {
                    this.laserPointer!.visibility = 0;

                    // If we have a valid targer point, then teleport the user
                    if(this.teleportPoint)
                    {
                        this.xrCamera!.position.x = this.teleportPoint.x;
                        this.xrCamera!.position.y = this.teleportPoint.y + this.xrCamera!.realWorldHeight;
                        this.xrCamera!.position.z = this.teleportPoint.z;
                        this.teleportPoint = null;
                    }
                }
            }
            
        }
    }

    // Toggle for locomotion mode
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