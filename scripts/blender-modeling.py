"""Trusted Orbsie modeling job runner.

This file is repository-owned and copied into the isolated job directory by
blender-modeling.ts. It consumes only the validated data-only job JSON; model
output never supplies Python, imports, paths, or expressions.
"""

import bpy
import json
import math
import os
from mathutils import Euler, Matrix, Vector


COORDINATE = Matrix(
    (
        (1.0, 0.0, 0.0, 0.0),
        (0.0, 0.0, 1.0, 0.0),
        (0.0, -1.0, 0.0, 0.0),
        (0.0, 0.0, 0.0, 1.0),
    )
)


def progress(stage, value, message):
    payload = {"stage": stage, "progress": value, "message": message}
    print("ORBSIE_PROGRESS " + json.dumps(payload, separators=(",", ":")), flush=True)


def source_vector(point):
    """Convert an Orbsie Y-up point to Blender's Z-up coordinates."""
    return (float(point[0]), -float(point[2]), float(point[1]))


def source_matrix(part):
    position = Matrix.Translation(Vector(part["position"]))
    rotation = Euler(part["rotation"], "XYZ").to_matrix().to_4x4()
    scale = Matrix.Diagonal((*part["scale"], 1.0))
    return COORDINATE.inverted() @ position @ rotation @ scale @ COORDINATE


def source_from_blender(point):
    """Convert a Blender Z-up world point to Orbsie's Y-up coordinates."""
    return [float(point.x), float(point.z), float(-point.y)]


def color_from_hex(value):
    def srgb_to_linear(channel):
        channel /= 255.0
        return channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4

    return tuple(srgb_to_linear(int(value[index : index + 2], 16)) for index in (1, 3, 5))


def material_for(color, cache):
    if color not in cache:
        material = bpy.data.materials.new("orbsie_" + color[1:].lower())
        material.diffuse_color = (*color_from_hex(color), 1.0)
        material.use_nodes = True
        principled = material.node_tree.nodes.get("Principled BSDF")
        principled.inputs["Base Color"].default_value = (*color_from_hex(color), 1.0)
        principled.inputs["Roughness"].default_value = 0.48
        cache[color] = material
    return cache[color]


def mesh_object(part):
    shape = part["shape"]
    segments = part["segments"]
    if shape == "box":
        bpy.ops.mesh.primitive_cube_add(size=2.0)
    elif shape == "sphere":
        bpy.ops.mesh.primitive_uv_sphere_add(
            segments=max(16, segments * 2),
            ring_count=max(8, segments),
            radius=1.0,
        )
    elif shape == "cylinder":
        bpy.ops.mesh.primitive_cylinder_add(
            vertices=segments,
            radius=1.0,
            depth=2.0,
        )
    elif shape == "cone":
        bpy.ops.mesh.primitive_cone_add(
            vertices=segments,
            radius1=1.0,
            radius2=0.0,
            depth=2.0,
        )
    elif shape == "torus":
        bpy.ops.mesh.primitive_torus_add(
            major_segments=segments,
            minor_segments=max(6, min(32, segments // 2)),
            major_radius=1.0,
            minor_radius=0.3,
        )
    elif shape == "mesh":
        vertices = [source_vector(point) for point in part["vertices"]]
        faces = [list(face) for face in part["faces"]]
        mesh = bpy.data.meshes.new("orbsie_mesh_" + part["id"])
        mesh.from_pydata(vertices, [], faces)
        mesh.update()
        obj = bpy.data.objects.new(part["id"], mesh)
        bpy.context.collection.objects.link(obj)
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        return obj
    elif shape == "extrude":
        profile = part["profile"]
        depth = part["depth"]
        count = len(profile)
        source_vertices = [
            [point[0], point[1], -depth / 2.0] for point in profile
        ] + [[point[0], point[1], depth / 2.0] for point in profile]
        faces = [list(reversed(range(count))), list(range(count, count * 2))]
        for index in range(count):
            next_index = (index + 1) % count
            faces.append(
                [index, next_index, count + next_index, count + index]
            )
        mesh = bpy.data.meshes.new("orbsie_extrude_" + part["id"])
        mesh.from_pydata([source_vector(point) for point in source_vertices], [], faces)
        mesh.update()
        obj = bpy.data.objects.new(part["id"], mesh)
        bpy.context.collection.objects.link(obj)
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        return obj
    elif shape == "lathe":
        profile = part["profile"]
        count = len(profile)
        source_vertices = []
        for segment in range(segments):
            angle = 2.0 * math.pi * segment / segments
            cosine = math.cos(angle)
            sine = math.sin(angle)
            for radius, height in profile:
                source_vertices.append(
                    [radius * cosine, height, radius * sine]
                )
        faces = []
        for segment in range(segments):
            next_segment = (segment + 1) % segments
            for index in range(count - 1):
                faces.append(
                    [
                        segment * count + index,
                        segment * count + index + 1,
                        next_segment * count + index + 1,
                        next_segment * count + index,
                    ]
                )
        if profile[0][0] > 0:
            faces.append([segment * count for segment in range(segments)])
        if profile[-1][0] > 0:
            faces.append(
                list(
                    reversed(
                        [segment * count + count - 1 for segment in range(segments)]
                    )
                )
            )
        mesh = bpy.data.meshes.new("orbsie_lathe_" + part["id"])
        mesh.from_pydata([source_vector(point) for point in source_vertices], [], faces)
        mesh.update()
        obj = bpy.data.objects.new(part["id"], mesh)
        bpy.context.collection.objects.link(obj)
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        return obj
    else:
        raise ValueError("Unsupported modeling shape")

    return bpy.context.object


def apply_modifiers(obj, part):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    if part["bevel"] > 0:
        modifier = obj.modifiers.new("orbsie_bevel", "BEVEL")
        modifier.width = part["bevel"]
        modifier.segments = 2
        modifier.limit_method = "ANGLE"
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    if part["subdivision"] > 0:
        modifier = obj.modifiers.new("orbsie_subdivision", "SUBSURF")
        modifier.subdivision_type = "CATMULL_CLARK"
        modifier.levels = part["subdivision"]
        modifier.render_levels = part["subdivision"]
        bpy.ops.object.modifier_apply(modifier=modifier.name)


def bounds_for(objects):
    points = []
    for obj in objects:
        points.extend(
            source_from_blender(obj.matrix_world @ Vector(corner))
            for corner in obj.bound_box
        )
    return {
        "min": [min(point[index] for point in points) for index in range(3)],
        "max": [max(point[index] for point in points) for index in range(3)],
    }


def main():
    with open("/work/job.json", "r", encoding="utf-8") as handle:
        job = json.load(handle)
    if job.get("version") != 1 or not job.get("parts"):
        raise ValueError("Invalid modeling job")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    materials = {}
    objects = []
    progress("modeling", 0.05, "Starting procedural modeling")
    for index, part in enumerate(job["parts"]):
        obj = mesh_object(part)
        apply_modifiers(obj, part)
        obj.name = part["id"]
        obj.data.materials.append(material_for(part["color"], materials))
        obj["orbsie_part_id"] = part["id"]
        obj["orbsie_shape"] = part["shape"]
        obj.matrix_world = source_matrix(part)
        objects.append(obj)
        progress(
            "modeling",
            0.1 + 0.75 * (index + 1) / len(job["parts"]),
            "Built " + part["id"],
        )

    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    progress("exporting", 0.9, "Exporting validated GLB")
    output_path = os.path.abspath("/work/model.glb")
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLB",
        export_materials="EXPORT",
        export_yup=True,
        use_selection=True,
    )

    material_stats = []
    for color, material in materials.items():
        material_stats.append(
            {
                "name": material.name,
                "color": color,
                "parts": [obj.name for obj in objects if obj.data.materials[0] == material],
            }
        )
    object_stats = [
        {
            "id": obj.get("orbsie_part_id"),
            "shape": obj.get("orbsie_shape"),
            "vertices": len(obj.data.vertices),
            "triangles": sum(len(poly.vertices) - 2 for poly in obj.data.polygons),
        }
        for obj in objects
    ]
    with open("/work/result.json", "w", encoding="utf-8") as handle:
        json.dump(
            {
                "version": 1,
                "blenderVersion": bpy.app.version_string,
                "bounds": bounds_for(objects),
                "materials": material_stats,
                "objects": object_stats,
                "output": output_path,
            },
            handle,
            indent=2,
            sort_keys=True,
        )
    progress("exporting", 1.0, "GLB export complete")


main()
