"""
Simple, clean stylised characters from Quaternius CC0 kits (owner request: "keep it simple and
normal"). Universal Base Characters (head, eyes, brows, hair) + Modular Character Outfits.
These share the Universal Animation Library skeleton, so clips play without distortion.

Usage:  blender -b -P tools/character/build_simple.py -- tools/character/simple/ines.json
"""
import json
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
import build_character as bc  # noqa: E402  (reuses recolour, gear, animation, export, previews)

ROOT = bc.ROOT
Q = os.path.normpath(os.path.join(ROOT, "..", "_tools", "quaternius"))
OUTFITS = os.path.join(Q, "outfits", "Modular Character Outfits - Fantasy[Standard]", "Exports", "glTF (Godot-Unreal)", "Outfits")
BASES = os.path.join(Q, "ubc", "Universal Base Characters[Standard]", "Base Characters", "Godot - UE")
HAIR = os.path.join(Q, "ubc", "Universal Base Characters[Standard]", "Hairstyles", "Rigged to Head Bone", "glTF (Godot -Unreal)")


def imp(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def armature_of(objs):
    return next(o for o in objs if o.type == "ARMATURE")


def bone_head(arm, name):
    b = next(b for b in arm.data.bones if b.name.lower() == name.lower())
    return arm.matrix_world @ b.head_local


def rebind(obj, arm):
    """Parent a skinned mesh to `arm` (same bone names), keeping its world position."""
    mw = obj.matrix_world.copy()
    obj.parent = arm
    obj.matrix_parent_inverse = arm.matrix_world.inverted()
    obj.matrix_world = mw
    for m in obj.modifiers:
        if m.type == "ARMATURE":
            m.object = arm
    if not any(m.type == "ARMATURE" for m in obj.modifiers):
        mod = obj.modifiers.new("Armature", "ARMATURE")
        mod.object = arm


def keep_head_only(body, cut_group_weight=0.5):
    """Delete everything but the head and upper neck from a full-body mesh."""
    import bmesh
    keep = np.zeros(len(body.data.vertices), bool)
    names = {g.index: g.name.lower() for g in body.vertex_groups}
    for v in body.data.vertices:
        w = sum(ge.weight for ge in v.groups if names.get(ge.group) in ("head", "neck_01", "neck_02"))
        keep[v.index] = w > cut_group_weight
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not keep[v.index]], context="VERTS")
    bm.to_mesh(body.data)
    bm.free()


def tint_material(obj, rule, label):
    """Recolour an object's base-colour texture (bc.recolor_image), restricted by colour class."""
    for slot in obj.material_slots:
        m = slot.material
        if not m:
            continue
        node, bsdf = bc.base_color_image(m)
        if node is None:
            continue
        m = m.copy()
        slot.material = m
        node, bsdf = bc.base_color_image(m)
        node.image = recolor_selective(node.image, f"{label}_{obj.name}", rule)


def recolor_selective(src, name, rule):
    """Replace only pixels whose hue falls in rule['hue'] (degrees, e.g. greens 70-170), keeping
    their shading; everything else (leather, buckles, stitching) is untouched."""
    px, w, h = bc.image_pixels(src)
    rgb = px[..., :3]
    mx, mn = rgb.max(-1), rgb.min(-1)
    sat = (mx - mn) / np.maximum(mx, 1e-4)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    hue = np.degrees(np.arctan2(np.sqrt(3) * (g - b), 2 * r - g - b)) % 360
    lo, hi = rule.get("hue", [0, 360])
    in_hue = ((hue >= lo) & (hue <= hi)) if lo <= hi else ((hue >= lo) | (hue <= hi))
    mask = (in_hue & (sat > rule.get("min_sat", 0.15)) & (sat <= rule.get("max_sat", 1.0))
            & (mx > rule.get("min_val", 0.0)) & (mx <= rule.get("max_val", 1.0))).astype(np.float32)
    mask = bc.box_blur(mask, 1)[..., None]
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    if rule.get("mode") == "tint":
        # Uniform multiply (skin tones): keeps every texture detail, can't band.
        new = rgb * np.array(rule["color"], np.float32)
    else:
        ref = float(np.median(lum[mask[..., 0] > 0.5])) if (mask > 0.5).any() else 0.3
        rel = np.clip(lum / max(ref, 1e-3), 0, 2.5) ** rule.get("contrast", 0.85)
        new = np.array(rule["color"], np.float32) * rel[..., None]
    out = rgb * (1 - mask) + np.clip(new, 0, 1) * mask
    img = bpy.data.images.new(name, w, h, alpha=True)
    img.pixels.foreach_set(np.concatenate([out, px[..., 3:4]], -1).astype(np.float32).ravel())
    img.pack()
    return img


def main():
    spec_path = sys.argv[sys.argv.index("--") + 1]
    with open(spec_path, "r", encoding="utf-8") as f:
        spec = json.load(f)
    bpy.ops.wm.read_homefile(use_empty=True)

    # 1. Outfit (provides the skeleton + clothed body incl. arms/hands).
    outfit = imp(os.path.join(OUTFITS, spec["outfit"] + ".gltf"))
    arm = armature_of(outfit)
    arm.name = spec["name"]
    for o in outfit:
        if o.type == "MESH" and (o.name.startswith("Icosphere") or any(k in o.name for k in spec.get("drop_parts", []))):
            bpy.data.objects.remove(o, do_unlink=True)

    # 2. Head (+ eyes, brows) from the base character, moved onto the outfit's neck.
    base = imp(os.path.join(BASES, spec["head_from"] + ".gltf"))
    barm = armature_of(base)
    bpy.context.view_layer.update()
    offset = bone_head(arm, "neck_01") - bone_head(barm, "neck_01")
    for o in base:
        if o.type != "MESH":
            continue
        if o.name.startswith("Icosphere"):
            bpy.data.objects.remove(o, do_unlink=True)
            continue
        if o.name not in ("Eyes", "Eyebrows"):
            keep_head_only(o)
        o.matrix_world.translation += offset
        rebind(o, arm)
    bpy.data.objects.remove(barm, do_unlink=True)

    # 3. Hair pieces (rigged to the head bone).
    for piece in spec.get("hair", []):
        objs = imp(os.path.join(HAIR, piece + ".gltf"))
        harm = next((o for o in objs if o.type == "ARMATURE"), None)
        for o in objs:
            if o.type == "MESH":
                if harm is not None:
                    bpy.context.view_layer.update()
                    o.matrix_world.translation += bone_head(arm, "Head") - bone_head(harm, "Head")
                rebind(o, arm)
        if harm is not None:
            bpy.data.objects.remove(harm, do_unlink=True)

    # Some kit files reference 'X_png.png' where the file on disk is 'X.png': repair, and drop any
    # texture node that still has no image data (a texture without an image breaks GLTFLoader).
    for img in bpy.data.images:
        if img.source == "FILE" and not img.packed_file and not os.path.exists(bpy.path.abspath(img.filepath)):
            alt = bpy.path.abspath(img.filepath).replace("_png.png", ".png")
            if os.path.exists(alt):
                img.filepath = alt
                img.reload()
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        for n in list(mat.node_tree.nodes):
            if n.type != "TEX_IMAGE":
                continue
            img = n.image
            missing = img is None or (img.source == "FILE" and not img.packed_file and not os.path.exists(bpy.path.abspath(img.filepath)))
            if missing:
                mat.node_tree.nodes.remove(n)

    # Every Quaternius file carries an 'Icosphere' helper object: drop them all.
    for o in [o for o in bpy.data.objects if o.name.startswith("Icosphere")]:
        bpy.data.objects.remove(o, do_unlink=True)

    # 4. Colours (selective recolours keep leather/metal details intact).
    for obj in [o for o in bpy.data.objects if o.type == "MESH"]:
        for key, rule in spec.get("recolor", {}).items():
            if key.lower() in obj.name.lower():
                rules = rule if isinstance(rule, list) else [rule]
                for r in rules:
                    tint_material(obj, r, key)

    # 5. Accessories (glasses, hat) from the main pipeline's generators.
    if spec.get("gear"):
        bc._updated["done"] = False
        body_like = next(o for o in bpy.data.objects if o.type == "MESH" and spec["head_from"].split("_")[0].lower() in o.name.lower())
        gear_head(spec, arm, body_like)

    bpy.context.view_layer.update()
    bc.setup_lookdev_scene()
    bc.render_previews(spec, os.path.join(ROOT, "art", "characters", "previews", spec["id"]))
    for o in [o for o in bpy.data.objects if o.type in {"LIGHT", "CAMERA"}]:
        bpy.data.objects.remove(o, do_unlink=True)

    # 6. Animation + export.
    meta = bc.build_animations(spec, arm)
    bc.render_pose_sheet(spec, arm, os.path.join(ROOT, "art", "characters", "previews", spec["id"]))
    out = os.path.join(ROOT, "public", "assets", "models", "characters", f"{spec['id']}.glb")
    bc.export_glb(spec, arm, out)
    with open(os.path.join(ROOT, "art", "characters", f"{spec['id']}.meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)


def gear_head(spec, arm, head_obj):
    """Glasses / bucket hat sized from the head mesh bounds."""
    co = np.array([tuple(head_obj.matrix_world @ v.co) for v in head_obj.data.vertices])
    co = co[co[:, 2] > np.percentile(co[:, 2], 25)]  # skull & face, not the neck stub
    hmin, hmax = co.min(0), co.max(0)
    hc = (hmin + hmax) / 2
    head_bone = next(b.name for b in arm.data.bones if b.name.lower() == "head")
    g = spec["gear"]
    if "glasses" in g:
        bc.rigid_accessory(arm, "glasses", bc.build_glasses(hc, hmin, hmax, g["glasses"]), head_bone,
                           bc.solid_material("tfe_glasses", g["glasses"]["color"], roughness=0.35, metallic=0.6))
    if "bucket_hat" in g:
        h = g["bucket_hat"]
        bc.rigid_accessory(arm, "bucket_hat", bc.build_bucket_hat(hc, hmin, hmax, h), head_bone,
                           bc.solid_material("tfe_hat", h["color"], roughness=0.92, image=bc.wrap_texture("tfe_hat_tex", h["color"], bands=0)))


if __name__ == "__main__":
    main()
