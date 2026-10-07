"""
THE FINAL EXPEDITION: character build pipeline (Blender 4.5 LTS + MPFB 2, all free / CC0).

Usage (from the project root):
  blender -b -P tools/character/build_character.py -- tools/character/specs/ines.json [--previews-only]

Stages:
  1. Body: MPFB human from the spec (phenotype macros + face/body shape targets), CC0 MakeHuman
     system assets (skin, eyes, brows, lashes, teeth, tongue, hair, clothes), game_engine rig.
  2. Look-dev: material/texture work (recolour, roughness, detail normals) + custom gear.
  3. Animation: CC0 Quaternius UAL clips retargeted to the rig + authored traversal clips.
  4. Export: GLB for the game + preview renders for review.

This file implements stage 1 and the preview renderer; later stages extend it.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if not argv:
        raise SystemExit("usage: blender -b -P build_character.py -- <spec.json> [--previews-only]")
    return argv[0], "--previews-only" in argv


def log(*a):
    print("[character]", *a, flush=True)


# ------------------------------------------------------------------------------------- stage 1
def build_body(spec):
    from bl_ext.blender_org.mpfb.services.humanservice import HumanService

    info = HumanService._create_default_human_info_dict()
    info["name"] = spec["name"]
    info["phenotype"] = spec["phenotype"]
    info["targets"] = spec.get("targets", [])
    for part in ("eyes", "eyebrows", "eyelashes", "teeth", "tongue", "hair"):
        info[part] = spec.get(part, "")
    info["clothes"] = spec.get("clothes", [])
    info["skin_mhmat"] = spec["skin_mhmat"]
    info["skin_material_type"] = "MAKESKIN"
    info["eyes_material_type"] = "MAKESKIN"
    info["rig"] = spec.get("rig", "game_engine")

    settings = HumanService.get_default_deserialization_settings()
    settings["subdiv_levels"] = 0  # game mesh: no subdivision
    settings["detailed_helpers"] = False
    # MPFB's feet_on_ground lifts the mesh but not the game_engine skeleton (verified: forearm
    # rotations then pivot ~0.8 m off). Build in MakeHuman's native frame; lift_to_ground() moves
    # mesh and skeleton together afterwards.
    settings["feet_on_ground"] = False
    basemesh = HumanService.deserialize_from_dict(info, settings)
    # Extra layers MPFB has no slot for (e.g. a second hair mesh: fringe + bun).
    from bl_ext.blender_org.mpfb.services.assetservice import AssetService
    for asset in spec.get("extra_hair", []):
        path = AssetService.find_asset_absolute_path(asset, asset_subdir="hair")
        if path:
            HumanService.add_mhclo_asset(path, basemesh, asset_type="hair", subdiv_levels=0, material_type="MAKESKIN")
    log("body built:", basemesh.name, len(basemesh.data.vertices), "verts")
    return basemesh


def character_objects():
    return [o for o in bpy.data.objects if o.type in {"MESH", "ARMATURE"}]


# ------------------------------------------------------------------------------------- stage 2
import numpy as np  # noqa: E402  (bundled with Blender)


def bake_and_cleanup(basemesh):
    """Apply shape targets, delete body faces hidden under clothes, drop MPFB helper geometry."""
    from bl_ext.blender_org.mpfb.services.targetservice import TargetService
    from bl_ext.blender_org.mpfb.services.exportservice import ExportService

    # MPFB fits the skeleton to the *base* shape (before macros such as height apply) and its refit
    # doesn't run headless. Record the mesh before/after baking the shape and carry every joint
    # along with the surrounding surface (deformation transfer).
    before = np.empty(len(basemesh.data.vertices) * 3, np.float32)
    basemesh.data.vertices.foreach_get("co", before)
    TargetService.bake_targets(basemesh)
    after = np.empty(len(basemesh.data.vertices) * 3, np.float32)
    basemesh.data.vertices.foreach_get("co", after)
    fit_skeleton_to_shape(basemesh, before.reshape(-1, 3), after.reshape(-1, 3))
    lift_to_ground(basemesh)
    validate_rig(basemesh, basemesh.parent)
    # Keep an unmasked copy: gear shells (wraps, belt, harness, boot shafts) are built from body
    # regions that the clothing masks are about to delete.
    ref = basemesh.copy()
    ref.data = basemesh.data.copy()
    ref.name = "tfe_body_ref"
    for m in list(ref.modifiers):
        if m.type != "ARMATURE":
            ref.modifiers.remove(m)
    bpy.context.collection.objects.link(ref)
    ref.hide_render = True
    ref.hide_viewport = True
    ExportService.bake_modifiers_remove_helpers(basemesh, bake_masks=True, bake_subdiv=False, remove_helpers=True, also_proxy=False)
    log("baked body:", len(basemesh.data.vertices), "verts", len(basemesh.data.polygons), "faces")
    return ref


def fit_skeleton_to_shape(basemesh, before, after, k=16):
    """Move every bone head/tail by the inverse-distance-weighted displacement of its k nearest
    body vertices between the base shape (what the rig was fitted to) and the final shape."""
    from mathutils.kdtree import KDTree
    arm = basemesh.parent
    real = vgroup_weights(basemesh, "body") > 0.5
    real &= vgroup_weights(basemesh, "HelperGeometry") < 0.5
    idx = np.nonzero(real)[0]
    tree = KDTree(len(idx))
    for n, i in enumerate(idx):
        tree.insert(Vector(before[i].tolist()), n)
    tree.balance()
    disp = after[idx] - before[idx]

    def moved(p):
        hits = tree.find_n(p, k)
        w = np.array([1.0 / max(d, 1e-4) for (_, _, d) in hits])
        dd = np.array([disp[n] for (_, n, _) in hits])
        return p + Vector((w[:, None] * dd).sum(0) / w.sum())

    # Bone positions are in armature space; the meshes share the armature's space (identity).
    select_only(arm)
    bpy.ops.object.mode_set(mode="EDIT")
    for eb in arm.data.edit_bones:
        roll = eb.roll
        h, t = moved(eb.head.copy()), moved(eb.tail.copy())
        eb.head, eb.tail = h, t
        eb.roll = roll
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.update()
    log("skeleton fitted to final body shape")


def lift_to_ground(basemesh):
    """Translate every character mesh AND the skeleton's rest pose so the soles sit at z = 0."""
    arm = basemesh.parent if basemesh.parent and basemesh.parent.type == "ARMATURE" else next(o for o in bpy.data.objects if o.type == "ARMATURE")
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    # Floor = lowest point of the shoes if present, else of the body (visible geometry only).
    shoes = [o for o in meshes if "shoe" in o.name or "boot" in o.name]
    probe = shoes or [basemesh]
    dg = bpy.context.evaluated_depsgraph_get()
    floor = 1e9
    for o in probe:
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        floor = min(floor, min((o.matrix_world @ v.co).z for v in me.vertices))
        ev.to_mesh_clear()
    lift = -floor
    for o in meshes:
        me = o.data
        if me.shape_keys:
            for kb in me.shape_keys.key_blocks:
                co = np.empty(len(kb.data) * 3, np.float32)
                kb.data.foreach_get("co", co)
                co[2::3] += lift
                kb.data.foreach_set("co", co)
        co = np.empty(len(me.vertices) * 3, np.float32)
        me.vertices.foreach_get("co", co)
        co[2::3] += lift
        me.vertices.foreach_set("co", co)
        me.update()
    select_only(arm)
    bpy.ops.object.mode_set(mode="EDIT")
    for eb in arm.data.edit_bones:
        eb.head.z += lift
        eb.tail.z += lift
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.update()
    log(f"lifted character + skeleton by {lift:.3f} m")


def validate_rig(body, arm):
    """Skeleton/mesh alignment gate: rotating the forearm 90 degrees must swing the hand around
    the elbow (hand travel = sqrt(2) x forearm length). Raises on failure."""
    g = body.vertex_groups.get("hand_l")
    idx = [v.index for v in body.data.vertices if g and any(ge.group == g.index and ge.weight > 0.8 for ge in v.groups)]
    masks = [m for m in body.modifiers if m.type == "MASK"]
    for m in masks:
        m.show_viewport = False

    def centroid():
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
        ev = body.evaluated_get(dg)
        me = ev.to_mesh()
        c = np.array([tuple(body.matrix_world @ me.vertices[i].co) for i in idx]).mean(0)
        ev.to_mesh_clear()
        return c

    c0 = centroid()
    pb = arm.pose.bones["lowerarm_l"]
    old_mode, old_rot = pb.rotation_mode, tuple(pb.rotation_quaternion)
    pb.rotation_mode = "XYZ"
    pb.rotation_euler = (0, 0, math.radians(90))
    c1 = centroid()
    pb.rotation_euler = (0, 0, 0)
    pb.rotation_mode = old_mode
    pb.rotation_quaternion = old_rot
    for m in masks:
        m.show_viewport = True
    bpy.context.view_layer.update()
    elbow = np.array(bone_world(arm, "lowerarm_l"))
    r = float(np.linalg.norm(c0 - elbow))
    moved = float(np.linalg.norm(c1 - c0))
    # Second check: the head bone must sit inside the head (vs the 'head'-weighted vertices).
    hg = body.vertex_groups.get("head")
    hverts = np.array([tuple(body.matrix_world @ v.co) for v in body.data.vertices
                       if hg and any(ge.group == hg.index and ge.weight > 0.9 for ge in v.groups)])
    hb = (np.array(bone_world(arm, "head")) + np.array(bone_world(arm, "head", tail=True))) / 2
    head_err = float(np.linalg.norm(hverts.mean(0) - hb)) if len(hverts) else 1.0
    # r = elbow -> hand-centroid distance (forearm + half a hand).
    # Head bone midpoint sits low (jaw hinge) vs the head-vertex centroid: ~0.10 m when fitted,
    # ~0.4 m when the skeleton belongs to a different body shape.
    ok = abs(moved - math.sqrt(2) * r) < 0.08 * math.sqrt(2) * r and 0.2 < r < 0.5 and head_err < 0.13
    log(f"rig check: forearm {r:.3f} m, hand moved {moved:.3f} m (expected {math.sqrt(2) * r:.3f}), head bone offset {head_err:.3f} m -> {'OK' if ok else 'FAIL'}")
    if not ok:
        raise RuntimeError("Skeleton is not aligned with the mesh (rig check failed)")


def select_only(obj):
    bpy.ops.object.mode_set(mode="OBJECT") if bpy.context.object and bpy.context.object.mode != "OBJECT" else None
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def separate_loose(obj):
    select_only(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="LOOSE")
    bpy.ops.object.mode_set(mode="OBJECT")
    return [o for o in bpy.context.selected_objects]


def base_color_image(mat):
    """The image texture feeding Principled Base Color (searching back through mix nodes)."""
    if not mat or not mat.use_nodes:
        return None, None
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if not bsdf:
        return None, None
    stack = [l.from_node for l in bsdf.inputs["Base Color"].links]
    seen = set()
    found = []
    while stack:
        n = stack.pop()
        if n in seen:
            continue
        seen.add(n)
        if n.type == "TEX_IMAGE" and n.image:
            found.append(n)
        for inp in n.inputs:
            stack.extend(l.from_node for l in inp.links)
    if not found:
        return None, bsdf
    # MakeSkin multiplies diffuse by an AO map: pick the colour texture, not the AO.
    def score(n):
        s = (n.image.name + " " + n.label + " " + n.name).lower()
        return (0 if "diffuse" in s or "albedo" in s else 1, 1 if ("ao" in s.split("_") or "occlusion" in s) else 0)
    found.sort(key=score)
    return found[0], bsdf


def image_pixels(img):
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    return px.reshape(h, w, 4), w, h


def sample_uv_colors(obj, px, w, h, max_samples=4000):
    uv = obj.data.uv_layers.active
    if not uv:
        return np.zeros((1, 4), np.float32)
    co = np.empty(len(uv.data) * 2, np.float32)
    uv.data.foreach_get("uv", co)
    co = co.reshape(-1, 2)
    if len(co) > max_samples:
        co = co[np.linspace(0, len(co) - 1, max_samples).astype(int)]
    xs = np.clip((co[:, 0] % 1.0) * (w - 1), 0, w - 1).astype(int)
    ys = np.clip((co[:, 1] % 1.0) * (h - 1), 0, h - 1).astype(int)
    return px[ys, xs]


def box_blur(a, r):
    if r <= 0:
        return a
    for axis in (0, 1):
        c = np.cumsum(np.pad(a, [(r + 1, r) if i == axis else (0, 0) for i in range(a.ndim)], mode="edge"), axis=axis)
        hi = np.take(c, range(2 * r + 1, c.shape[axis]), axis=axis)
        lo = np.take(c, range(0, c.shape[axis] - 2 * r - 1), axis=axis)
        a = (hi - lo) / (2 * r + 1)
    return a


def recolor_image(src, name, target, contrast=0.8, flatten=0, mode="colorize", ref_samples=None):
    """New image: colour replaced by `target`, shading (luminance) kept. `flatten` blurs the
    luminance (radius px) to erase printed patterns (stripes, denim fades) but keep folds/AO."""
    px, w, h = image_pixels(src)
    rgb = px[..., :3]
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    t = np.array(target, np.float32)
    if mode == "tint":
        out = np.clip(rgb * t, 0, 1)
    elif mode == "iris":
        mx = rgb.max(-1)
        sat = (mx - rgb.min(-1)) / np.maximum(mx, 1e-4)
        k = np.clip((sat - 0.18) * 4, 0, 1)[..., None]
        out = rgb * (1 - k) + (t * (lum[..., None] / max(float(np.median(lum[k[..., 0] > 0.5])) if (k > 0.5).any() else 0.4, 1e-3))) * k
    else:
        base = box_blur(lum, flatten) if flatten else lum
        detail = lum / np.maximum(box_blur(lum, 6), 1e-3) if flatten else 1.0
        ref = float(np.median(ref_samples)) if ref_samples is not None and len(ref_samples) else float(np.median(base))
        rel = np.clip(base / max(ref, 1e-3), 0, 2.5) ** contrast
        if flatten:
            rel = rel * np.clip(detail, 0.6, 1.4) ** 0.35  # keep fine weave, drop the pattern
        out = np.clip(t * rel[..., None], 0, 1)
    new = np.concatenate([out, px[..., 3:4]], axis=-1).astype(np.float32)
    img = bpy.data.images.new(name, w, h, alpha=True)
    img.pixels.foreach_set(new.ravel())
    img.pack()
    return img


def classify(rgb):
    r, g, b = [float(x) for x in rgb[:3]]
    mx, mn = max(r, g, b), min(r, g, b)
    sat = (mx - mn) / max(mx, 1e-4)
    if sat < 0.18:
        return "neutral_dark" if mx < 0.25 else "neutral"
    if b >= r and b >= g:
        return "blue"
    if r >= g and r >= b:
        return "red" if (r - g) > 0.12 else "brown"
    return "green"


def simplify_material(mat, bake_ao=True):
    """Export-friendly graph: colour texture -> Base Color directly. MakeSkin's 'diffuseIntensity'
    mix lightened everything toward white, and mix nodes defeat the glTF exporter. The AO map is
    multiplied into the colour pixels instead (glTF-safe)."""
    nt = mat.node_tree
    node, bsdf = base_color_image(mat)
    if node is None or bsdf is None:
        return
    ao = next((n for n in nt.nodes if n.type == "TEX_IMAGE" and n.image and "ao" in n.image.name.lower().replace(".png", "").split("_")), None)
    if bake_ao and ao is not None and ao.image.size[:] == node.image.size[:]:
        px, w, h = image_pixels(node.image)
        aopx, _, _ = image_pixels(ao.image)
        px[..., :3] *= (0.35 + 0.65 * aopx[..., :1])
        img = bpy.data.images.new(node.image.name + "_ao", w, h, alpha=True)
        img.pixels.foreach_set(px.ravel())
        img.pack()
        node.image = img
    for l in list(bsdf.inputs["Base Color"].links):
        nt.links.remove(l)
    nt.links.new(node.outputs["Color"], bsdf.inputs["Base Color"])
    for n in list(nt.nodes):
        if n.type == "MIX_RGB" or (n is ao):
            nt.nodes.remove(n)


def set_principled(mat, **kw):
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if not bsdf:
        return
    for k, v in kw.items():
        if k in bsdf.inputs and not bsdf.inputs[k].links:
            bsdf.inputs[k].default_value = v


def classify_garments():
    """Classify split garments on their ORIGINAL textures (before AO baking darkens them)."""
    for obj in [o for o in bpy.data.objects if o.type == "MESH" and o.get("tfe_garment")]:
        mat = obj.material_slots[0].material if obj.material_slots else None
        node, _ = base_color_image(mat)
        if node is not None:
            px, w, h = image_pixels(node.image)
            med = np.median(sample_uv_colors(obj, px, w, h), axis=0)
            obj["tfe_class"] = classify(med)
            log("classified", obj.name, obj["tfe_class"], np.round(med[:3], 3).tolist())


def paint_scar(spec, body, brows):
    """Thin pale scar through the character's LEFT eyebrow, painted into the skin texture, with a
    matching gap cut into the eyebrow cards (STORY_BIBLE: Ines)."""
    cfg = spec.get("look", {}).get("scar")
    if not cfg or body is None:
        return
    # Character faces -Y, so her left is +X. Find the left brow's centre from the brow mesh.
    bco = np.array([brows.matrix_world @ v.co for v in brows.data.vertices]) if brows else None
    if bco is None or not len(bco):
        return
    left = bco[bco[:, 0] > 0]
    center = left.mean(0) + np.array([cfg.get("dx", 0.006), 0, 0])
    top = center + np.array([cfg.get("tilt", 0.004), 0, cfg.get("length", 0.03) / 2])
    bot = center - np.array([cfg.get("tilt", 0.004), 0, cfg.get("length", 0.03) / 2])

    def uv_of(obj, p3):
        """UV of the surface point nearest to a world position (barycentric on the nearest face)."""
        from mathutils.bvhtree import BVHTree
        from mathutils.geometry import barycentric_transform
        bvh = BVHTree.FromObject(obj, bpy.context.evaluated_depsgraph_get())
        inv = obj.matrix_world.inverted()
        loc, _, fi, _ = bvh.find_nearest(inv @ Vector(p3.tolist()))
        if fi is None:
            return None
        me = obj.data
        poly = me.polygons[fi]
        uvl = me.uv_layers.active.data
        vs = [me.vertices[me.loops[li].vertex_index].co for li in poly.loop_indices[:3]]
        uvs = [Vector((*uvl[li].uv, 0)) for li in poly.loop_indices[:3]]
        uvp = barycentric_transform(loc, vs[0], vs[1], vs[2], uvs[0], uvs[1], uvs[2])
        return np.array([uvp.x, uvp.y])

    def stroke(obj, width_m, fn):
        mat = obj.material_slots[0].material
        node, _ = base_color_image(mat)
        if node is None or not obj.data.uv_layers:
            return
        a, b = uv_of(obj, top), uv_of(obj, bot)
        if a is None or b is None:
            return
        px, w, h = image_pixels(node.image)
        # Texel size of the stroke: scale metres -> UV using the stroke's own length.
        uv_len = np.linalg.norm((a - b) * [w, h])
        rad_px = max(1.5, width_m / max(np.linalg.norm(top - bot), 1e-6) * uv_len)
        n = int(uv_len * 2) + 2
        yy, xx = np.mgrid[-int(rad_px * 2) - 1:int(rad_px * 2) + 2, -int(rad_px * 2) - 1:int(rad_px * 2) + 2]
        disc = np.clip(1 - np.sqrt(xx ** 2 + yy ** 2) / (rad_px * 2), 0, 1)
        for i in range(n):
            t = i / (n - 1)
            # Taper the ends like a healed cut.
            k = disc * (np.sin(np.pi * t) ** 0.5)
            cx, cy = (a + (b - a) * t) * [w - 1, h - 1]
            x0, y0 = int(cx) + xx[0, 0], int(cy) + yy[0, 0]
            if x0 < 0 or y0 < 0 or x0 + disc.shape[1] > w or y0 + disc.shape[0] > h:
                continue
            fn(px[y0:y0 + disc.shape[0], x0:x0 + disc.shape[1]], k)
        img = bpy.data.images.new(node.image.name + "_scar", w, h, alpha=True)
        img.pixels.foreach_set(px.ravel())
        img.pack()
        node.image = img

    tone = np.array(cfg.get("color", [0.86, 0.72, 0.64]), np.float32)

    def skin(patch, k):
        kk = (k ** 1.5)[..., None] * cfg.get("strength", 0.75)
        patch[..., :3] = patch[..., :3] * (1 - kk) + tone * kk

    def brow(patch, k):
        patch[..., 3] = patch[..., 3] * (1 - np.clip(k * 2.5, 0, 1))

    stroke(body, cfg.get("radius", 0.002), skin)
    if brows:
        stroke(brows, cfg.get("radius", 0.002) * 1.6, brow)
    log("scar painted at", np.round(center, 3).tolist())


def apply_look(spec):
    """Recolour + material response per the spec's `look` rules."""
    look = spec.get("look", {})
    rules = look.get("garments", {})
    for obj in [o for o in bpy.data.objects if o.type == "MESH"]:
        kind = obj.get("tfe_kind") or obj.name.split(".", 1)[-1]
        for slot in obj.material_slots:
            mat = slot.material
            if not mat:
                continue
            if not mat.get("tfe_simplified"):
                mat = mat.copy()
                slot.material = mat
                simplify_material(mat)
                mat["tfe_simplified"] = True
            node, bsdf = base_color_image(mat)
            rule = None
            if kind in rules:
                rule = rules[kind]
            elif obj.get("tfe_class"):
                # Colour-class rules only apply to split garments (never teeth, tongue, etc.).
                cls = obj["tfe_class"]
                rule = rules.get(f"{obj.get('tfe_garment', '')}:{cls}") or rules.get(cls)
            if not rule:
                continue
            mat = mat.copy()
            slot.material = mat
            node, bsdf = base_color_image(mat)
            if node is not None and "color" in rule:
                px, w, h = image_pixels(node.image)
                samples = sample_uv_colors(obj, px, w, h)
                lum = samples[:, :3] @ np.array([0.2126, 0.7152, 0.0722], np.float32)
                node.image = recolor_image(
                    node.image, f"{spec['id']}_{obj.name}_{mat.name}", rule["color"],
                    contrast=rule.get("contrast", 0.8), flatten=rule.get("flatten", 0),
                    mode=rule.get("mode", "colorize"), ref_samples=lum,
                )
            params = {k: rule[k] for k in ("Roughness", "Metallic", "Sheen Weight", "Sheen Roughness", "Specular IOR Level", "Coat Weight") if k in rule}
            set_principled(mat, **params)


# ------------------------------------------------------------------------------------- gear
_updated = {"done": False}


def bone_world(arm, name, tail=False):
    # matrix_world is stale in background mode until the depsgraph has been evaluated once.
    if not _updated["done"]:
        bpy.context.view_layer.update()
        _updated["done"] = True
    b = arm.data.bones.get(name)
    return arm.matrix_world @ (b.tail_local if tail else b.head_local)


def vgroup_weights(obj, group_name):
    g = obj.vertex_groups.get(group_name)
    w = np.zeros(len(obj.data.vertices), np.float32)
    if g is None:
        return w
    gi = g.index
    for v in obj.data.vertices:
        for ge in v.groups:
            if ge.group == gi:
                w[v.index] = ge.weight
    return w


def shell_from_body(body, name, vert_mask, offset, material, uv_fn=None):
    """A tight garment/gear shell made from the body's own faces in a region, pushed out along
    the normals. It inherits the body's skin weights, so it deforms perfectly with the rig."""
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.verts.ensure_lookup_table()
    keep_faces = [f for f in bm.faces if all(vert_mask[v.index] for v in f.verts)]
    drop = set(bm.faces) - set(keep_faces)
    bmesh.ops.delete(bm, geom=list(drop), context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * offset
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    obj.matrix_world = body.matrix_world.copy()
    obj.parent = body.parent
    for g in body.vertex_groups:
        obj.vertex_groups.new(name=g.name)
    # bmesh keeps deform layers: copy weights via the deform layer.
    me2 = obj.data
    mod = obj.modifiers.new("Armature", "ARMATURE")
    arm_mod = next((m for m in body.modifiers if m.type == "ARMATURE"), None)
    mod.object = arm_mod.object if arm_mod else body.parent
    me2.materials.append(material)
    if uv_fn:
        uv_fn(obj)
    obj["tfe_kind"] = name
    return obj


def solid_material(name, color, roughness=0.8, metallic=0.0, sheen=0.0, image=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Sheen Weight"].default_value = sheen
    if image is not None:
        tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = image
        mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    mat["tfe_simplified"] = True
    return mat


def wrap_texture(name, base, size=512, bands=7):
    """Cloth-wrap pattern: diagonal overlapping bands with soft shading and weave noise
    (bands=0: plain woven cloth)."""
    y, x = np.mgrid[0:size, 0:size].astype(np.float32) / size
    phase = (x * 1.0 + y * bands) % 1.0
    edge = np.clip(np.minimum(phase, 1 - phase) * 9, 0, 1) if bands else np.ones_like(x)  # dark seams between bands
    rng = np.random.default_rng(7)
    weave = 0.92 + 0.08 * rng.random((size, size)).astype(np.float32)
    weave = box_blur(weave, 1)
    shade = (0.55 + 0.45 * edge) * weave
    col = np.array(base, np.float32)[None, None, :] * shade[..., None]
    rgba = np.concatenate([np.clip(col, 0, 1), np.ones((size, size, 1), np.float32)], -1)
    img = bpy.data.images.new(name, size, size, alpha=True)
    img.pixels.foreach_set(rgba.ravel())
    img.pack()
    return img


def cylinder_uv(obj, axis_a, axis_b, around_scale=1.0, along_scale=1.0):
    """UVs for a limb shell: u = angle around the limb axis, v = distance along it."""
    me = obj.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    a = np.array(axis_a)
    d = np.array(axis_b) - a
    L = np.linalg.norm(d)
    d = d / max(L, 1e-6)
    ref = np.array([0, 0, 1.0]) if abs(d[2]) < 0.9 else np.array([1.0, 0, 0])
    e1 = np.cross(d, ref)
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(d, e1)
    mw = obj.matrix_world
    for poly in me.polygons:
        for li in poly.loop_indices:
            p = np.array(mw @ me.vertices[me.loops[li].vertex_index].co) - a
            ang = (math.atan2(p @ e2, p @ e1) / (2 * math.pi)) % 1.0
            uv[li].uv = (ang * around_scale, (p @ d) / L * along_scale)


def rigid_accessory(arm, name, mesh, bone, material):
    """Mesh rigidly bound to one bone (glasses, hats): one vertex group, weight 1."""
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = arm
    vg = obj.vertex_groups.new(name=bone)
    vg.add(list(range(len(mesh.vertices))), 1.0, "REPLACE")
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    mesh.materials.append(material)
    for p in mesh.polygons:
        p.use_smooth = True
    obj["tfe_kind"] = name
    return obj


def _from_bmesh(bm, name):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return me


def _torus(bm, center, axis_u, axis_v, R, r, seg=28, rseg=6):
    """Ring of radius R in the (u, v) plane around `center`, tube radius r."""
    c = Vector(center)
    u, v = Vector(axis_u).normalized(), Vector(axis_v).normalized()
    n = u.cross(v)
    rings = []
    for i in range(seg):
        a = i / seg * 2 * math.pi
        radial = u * math.cos(a) + v * math.sin(a)
        ring = []
        for j in range(rseg):
            b = j / rseg * 2 * math.pi
            ring.append(bm.verts.new(c + radial * (R + r * math.cos(b)) + n * (r * math.sin(b))))
        rings.append(ring)
    for i in range(seg):
        for j in range(rseg):
            bm.faces.new((rings[i][j], rings[(i + 1) % seg][j], rings[(i + 1) % seg][(j + 1) % rseg], rings[i][(j + 1) % rseg]))


def _tube(bm, p0, p1, r, rseg=6):
    p0, p1 = Vector(p0), Vector(p1)
    d = (p1 - p0).normalized()
    ref = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
    e1 = d.cross(ref).normalized()
    e2 = d.cross(e1)
    a, b = [], []
    for j in range(rseg):
        t = j / rseg * 2 * math.pi
        off = (e1 * math.cos(t) + e2 * math.sin(t)) * r
        a.append(bm.verts.new(p0 + off))
        b.append(bm.verts.new(p1 + off))
    for j in range(rseg):
        k = (j + 1) % rseg
        bm.faces.new((a[j], a[k], b[k], b[j]))


def build_glasses(hc, hmin, hmax, g):
    """Round wire spectacles (Toby, STORY_BIBLE): two rims, bridge, temple arms, and a thick
    'tape' wrap at one hinge."""
    import bmesh
    bm = bmesh.new()
    half_w = (hmax[0] - hmin[0]) * 0.5
    front_y = hmin[1] + g.get("forward", 0.012)  # face points -Y; rims sit just in front of the eyes
    eye_z = hmin[2] + (hmax[2] - hmin[2]) * g.get("eye_height", 0.47)
    R = g.get("radius", 0.02)
    wire = g.get("wire", 0.0014)
    sep = g.get("separation", 0.031)
    X, Z = (1, 0, 0), (0, 0, 1)
    for side in (-1, 1):
        _torus(bm, (hc[0] + side * sep, front_y, eye_z), X, Z, R, wire)
    _tube(bm, (hc[0] - sep + R, front_y, eye_z + 0.004), (hc[0] + sep - R, front_y, eye_z + 0.004), wire)
    for side in (-1, 1):
        hinge = (hc[0] + side * (sep + R), front_y, eye_z + 0.003)
        ear = (hc[0] + side * half_w * 0.98, hc[1] + 0.005, eye_z + 0.004)
        behind = (hc[0] + side * half_w * 0.96, hc[1] + 0.05, eye_z - 0.018)
        _tube(bm, hinge, ear, wire)
        _tube(bm, ear, behind, wire)
    # Tape around the left hinge.
    hinge_l = Vector((hc[0] + (sep + R), front_y, eye_z + 0.003))
    _tube(bm, hinge_l + Vector((0.004, 0.002, 0)), hinge_l + Vector((0.012, 0.008, 0)), wire * 2.6, rseg=8)
    return _from_bmesh(bm, "glasses")


def build_bucket_hat(hc, hmin, hmax, g):
    """Bucket hat: lathe profile (crown, band, sloped brim) sized to the head bounds."""
    import bmesh
    rx = (hmax[0] - hmin[0]) / 2 * g.get("fit", 1.06)
    ry = (hmax[1] - hmin[1]) / 2 * g.get("fit", 1.06)
    top = hmax[2] + g.get("lift", 0.012)
    band_z = hmin[2] + (hmax[2] - hmin[2]) * g.get("band_height", 0.70)
    brim = g.get("brim", 0.055)
    droop = g.get("droop", 0.035)
    # (radius scale, z) profile from the crown centre outward, as fractions.
    prof = [(0.0, top), (0.55, top - 0.004), (0.92, top - 0.03), (1.0, band_z + 0.02), (1.01, band_z),
            (1.0 + brim / rx, band_z - droop * 0.6), (1.0 + 1.25 * brim / rx, band_z - droop)]
    bm = bmesh.new()
    segs = 32
    rings = []
    for (s, z) in prof:
        ring = []
        for i in range(segs):
            a = i / segs * 2 * math.pi
            ring.append(bm.verts.new((hc[0] + math.cos(a) * rx * s, hc[1] + math.sin(a) * ry * s, z)))
        rings.append(ring)
    for k in range(len(rings) - 1):
        for i in range(segs):
            j = (i + 1) % segs
            bm.faces.new((rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # Cloth thickness so the brim reads from below.
    res = bmesh.ops.solidify(bm, geom=bm.faces, thickness=0.004)
    me = _from_bmesh(bm, "bucket_hat")
    # Simple planar UVs for the cloth texture.
    me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    for poly in me.polygons:
        for li in poly.loop_indices:
            v = me.vertices[me.loops[li].vertex_index].co
            uv[li].uv = ((v.x - hc[0]) * 8 + 0.5, (v.y - hc[1]) * 8 + v.z * 4)
    return me


def build_gear(spec, arm, body):
    gear = spec.get("look", {}).get("gear", {})
    if not gear:
        return
    co = np.array([body.matrix_world @ v.co for v in body.data.vertices])
    # Only real skin: the MakeHuman base mesh also carries hidden helper geometry (tights, skirt,
    # joint cubes) whose vertices share the limb weights.
    real = vgroup_weights(body, "body") > 0.5
    real &= vgroup_weights(body, "HelperGeometry") < 0.5
    made = []
    if "forearm_wraps" in gear:
        g = gear["forearm_wraps"]
        img = wrap_texture("tfe_wrap_tex", g["color"])
        mat = solid_material("tfe_forearm_wraps", g["color"], roughness=0.88, sheen=0.15, image=img)
        for side in ("l", "r"):
            w = vgroup_weights(body, f"lowerarm_{side}") + vgroup_weights(body, f"hand_{side}") * 0.0
            elbow = np.array(bone_world(arm, f"lowerarm_{side}"))
            wrist = np.array(bone_world(arm, f"lowerarm_{side}", tail=True))
            d = wrist - elbow
            t = ((co - elbow) @ d) / (d @ d)
            mask = real & (w > 0.35) & (t > g.get("start", 0.3)) & (t < g.get("end", 1.06))
            obj = shell_from_body(body, f"forearm_wrap_{side}", mask, g.get("offset", 0.004), mat,
                                  uv_fn=lambda o, a=elbow, b=wrist: cylinder_uv(o, a, b, 1.0, 1.4))
            made.append(obj)
    if "belt" in gear:
        g = gear["belt"]
        mat = solid_material("tfe_belt", g["color"], roughness=0.5)
        hips = np.array(bone_world(arm, "pelvis"))
        z0 = hips[2] + g.get("z_from_pelvis", 0.08)
        mask = real & (np.abs(co[:, 2] - z0) < g.get("width", 0.055) / 2) & (vgroup_weights(body, "spine_01") + vgroup_weights(body, "pelvis") + vgroup_weights(body, "thigh_l") + vgroup_weights(body, "thigh_r") > 0.2)
        made.append(shell_from_body(body, "belt", mask, g.get("offset", 0.035), mat))
    if "thigh_loops" in gear:
        g = gear["thigh_loops"]
        mat = solid_material("tfe_harness", g["color"], roughness=0.6)
        for side in ("l", "r"):
            hip = np.array(bone_world(arm, f"thigh_{side}"))
            knee = np.array(bone_world(arm, f"thigh_{side}", tail=True))
            d = knee - hip
            t = ((co - hip) @ d) / (d @ d)
            mask = real & (vgroup_weights(body, f"thigh_{side}") > 0.25) & (np.abs(t - g.get("t", 0.16)) < g.get("width", 0.035))
            made.append(shell_from_body(body, f"harness_{side}", mask, g.get("offset", 0.022), mat))
    if "scarf" in gear:
        g = gear["scarf"]
        img = wrap_texture("tfe_scarf_tex", g["color"], bands=3)
        mat = solid_material("tfe_scarf", g["color"], roughness=0.9, sheen=0.2, image=img)
        neck = np.array(bone_world(arm, "neck_01"))
        head = np.array(bone_world(arm, "head"))
        # Skin within reach of the neck bone segment, between its base and the jaw line.
        seg = head - neck
        t = np.clip(((co - neck) @ seg) / (seg @ seg), 0, 1)
        dist = np.linalg.norm(co - (neck + t[:, None] * seg), axis=1)
        mask = real & (dist < g.get("reach", 0.085)) & (co[:, 2] > neck[2] - g.get("below", 0.03)) & (co[:, 2] < head[2] - g.get("gap", 0.0))
        made.append(shell_from_body(body, "scarf", mask, g.get("offset", 0.022), mat,
                                    uv_fn=lambda o, a=neck, b=head: cylinder_uv(o, a, b, 2.0, 1.0)))
    head_pts = co[real & (vgroup_weights(body, "head") > 0.9)]
    if len(head_pts) and ("glasses" in gear or "bucket_hat" in gear):
        hmin, hmax = head_pts.min(0), head_pts.max(0)
        hc = (hmin + hmax) / 2
        if "glasses" in gear:
            g = gear["glasses"]
            made.append(rigid_accessory(arm, "glasses", build_glasses(hc, hmin, hmax, g), "head",
                                        solid_material("tfe_glasses", g["color"], roughness=0.35, metallic=g.get("metallic", 0.6))))
        if "bucket_hat" in gear:
            g = gear["bucket_hat"]
            made.append(rigid_accessory(arm, "bucket_hat", build_bucket_hat(hc, hmin, hmax, g), "head",
                                        solid_material("tfe_hat", g["color"], roughness=0.92, sheen=0.25, image=wrap_texture("tfe_hat_tex", g["color"], bands=0))))
    if "boot_shafts" in gear:
        g = gear["boot_shafts"]
        mat = solid_material("tfe_boot_leather", g["color"], roughness=0.5)
        for side in ("l", "r"):
            ankle = np.array(bone_world(arm, f"calf_{side}", tail=True))
            mask = real & (vgroup_weights(body, f"calf_{side}") + vgroup_weights(body, f"foot_{side}") > 0.3) & (co[:, 2] < g["top_z"]) & (co[:, 2] > ankle[2] - 0.05)
            made.append(shell_from_body(body, f"boot_shaft_{side}", mask, g.get("offset", 0.014), mat))
    log("gear:", [(o.name, len(o.data.polygons)) for o in made])
    return made


def tuck_trousers(spec, arm):
    """Tuck trouser legs into the tall boots: pull the cuffs inside the boot shafts."""
    cfg = spec.get("look", {}).get("tuck")
    if not cfg:
        return
    for obj in [o for o in bpy.data.objects if o.type == "MESH" and o.get("tfe_class") == cfg.get("class", "blue")]:
        me = obj.data
        for side, sx in (("l", 1), ("r", -1)):
            knee = np.array(bone_world(arm, f"calf_{side}"))
            ankle = np.array(bone_world(arm, f"calf_{side}", tail=True))
            for v in me.vertices:
                p = obj.matrix_world @ v.co
                if p.z > cfg["top_z"] or (p.x * sx) < 0:
                    continue
                t = min(1.0, max(0.0, (p.z - ankle[2]) / max(knee[2] - ankle[2], 1e-4)))
                cx = ankle[0] + (knee[0] - ankle[0]) * t
                cy = ankle[1] + (knee[1] - ankle[1]) * t
                k = cfg.get("squeeze", 0.72)
                fade = min(1.0, (cfg["top_z"] - p.z) / 0.04)
                s = 1 - (1 - k) * fade
                world = Vector((cx + (p.x - cx) * s, cy + (p.y - cy) * s, p.z))
                v.co = obj.matrix_world.inverted() @ world
        me.update()
    log("tucked trousers into boots")


def shorten_sleeves(spec, arm):
    """Three-quarter sleeves: delete jacket faces beyond a fraction of the forearm."""
    cfg = spec.get("look", {}).get("sleeves")
    if not cfg:
        return
    import bmesh
    for obj in [o for o in bpy.data.objects if o.type == "MESH" and o.get("tfe_class") in cfg.get("classes", [])]:
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        kill = set()
        for side in ("l", "r"):
            elbow = np.array(bone_world(arm, f"lowerarm_{side}"))
            wrist = np.array(bone_world(arm, f"lowerarm_{side}", tail=True))
            d = wrist - elbow
            for f in bm.faces:
                c = np.array(obj.matrix_world @ f.calc_center_median())
                if ((c - elbow) @ d) / (d @ d) > cfg.get("cut_t", 0.45) and np.sign(c[0]) == np.sign(elbow[0]):
                    kill.add(f)
        bmesh.ops.delete(bm, geom=list(kill), context="FACES")
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
        bm.to_mesh(obj.data)
        bm.free()
        log("sleeves shortened on", obj.name, len(kill), "faces removed")


def bunify_hair(hair_obj, spec):
    """Coil the ponytail's tail into a low, loose bun at the nape (STORY_BIBLE rev 1.1)."""
    cfg = spec.get("look", {}).get("bun")
    if not cfg or not hair_obj:
        return
    me = hair_obj.data
    co = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    tie_z = float(np.percentile(co[:, 2], cfg.get("tie_percentile", 52)))
    back_y = float(co[:, 1].max())
    tail = co[:, 2] < tie_z
    if not tail.any():
        return
    zmin = float(co[tail, 2].min())
    t = (tie_z - co[tail, 2]) / max(tie_z - zmin, 1e-4)  # 0 at the tie .. 1 at the tip
    center = np.array([0.0, back_y - cfg.get("inset", 0.03), tie_z - cfg.get("drop", 0.035)], np.float32)
    turns = cfg.get("turns", 1.35)
    theta = t * turns * 2 * np.pi
    r = cfg.get("radius", 0.042) * (1.0 - 0.35 * t)
    x = co[tail, 0] * cfg.get("spread", 0.55)
    new = np.stack([
        center[0] + x + np.sin(theta * 0.5) * r * 0.35,
        center[1] + np.cos(theta) * r * 0.75,
        center[2] + np.sin(theta) * r,
    ], axis=1)
    # Blend the first part of the tail so the hair flows from the tie into the coil.
    w = np.clip(t / 0.12, 0, 1)[:, None]
    co[tail] = co[tail] * (1 - w) + new * w
    me.vertices.foreach_set("co", co.ravel())
    me.update()
    log("bun: coiled", int(tail.sum()), "hair verts")
    if cfg.get("remove_cap"):
        # Another hair layer provides the scalp/fringe; keep only the bun (and the tie area).
        import bmesh
        bm = bmesh.new()
        bm.from_mesh(me)
        cap = [v for v in bm.verts if v.co.z > tie_z + cfg.get("keep_above_tie", 0.01)]
        bmesh.ops.delete(bm, geom=cap, context="VERTS")
        bm.to_mesh(me)
        bm.free()
        log("bun: removed scalp cap", len(cap), "verts")


# ------------------------------------------------------------------------------------- stage 3
def build_animations(spec, arm):
    sys.path.insert(0, os.path.dirname(__file__))
    import retarget  # noqa: E402

    with open(os.path.join(os.path.dirname(__file__), "clips.json"), "r", encoding="utf-8") as f:
        cfg = json.load(f)
    bpy.context.scene.render.fps = 30
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
    loaded = {}

    def source(key):
        if key not in loaded:
            path = os.path.normpath(os.path.join(ROOT, cfg["sources"][key].replace("{id}", spec.get("legacy_clips_from", spec["id"]))))
            before = set(bpy.data.actions)
            src, objs = retarget.import_gltf_armature(path)
            # Libraries reuse clip names (in-place vs root-motion): remember which actions came from where.
            loaded[key] = (src, objs, [a for a in bpy.data.actions if a not in before])
        return loaded[key][0]

    def find_action(key, name):
        acts = loaded[key][2]
        return next((a for a in acts if a.name == name), None) or next(
            (a for a in acts if a.name.startswith(name + "_") or a.name.startswith(name + ".")), None)

    made = []
    meta = {"clips": {}, "strides": {}}
    for clip, (key, src_name) in cfg["clips"].items():
        src = source(key)
        act = find_action(key, src_name)
        if act is None:
            log("missing source clip", key, src_name)
            continue
        bone_map = retarget.auto_map(src, arm, cfg.get("aliases", {}).get(key))
        out = retarget.retarget_action(src, arm, act, bone_map, clip, hip_src=cfg["hips"][key], hip_tgt="pelvis")
        made.append(out)
        meta["clips"][clip] = {"source": f"{key}:{src_name}", "frames": len(out.fcurves[0].keyframe_points) if out.fcurves else 0, "bones": len(bone_map)}
    for clip, (key, src_name) in cfg.get("strides", {}).items():
        src = source(key)
        act = find_action(key, src_name)
        if act is not None:
            dist, dur = retarget.measure_stride(src, act, "root")
            # Scale the source stride to this character's leg length (hip height ratio).
            s_hip = (src.matrix_world @ src.data.bones["pelvis"].head_local).z
            t_hip = (arm.matrix_world @ arm.data.bones["pelvis"].head_local).z
            meta["strides"][clip] = {"metres": round(dist * t_hip / max(s_hip, 1e-4), 3), "seconds": round(dur, 3)}
    # Remove everything that was imported for retargeting.
    for key, (src, objs, _) in loaded.items():
        for o in objs:
            if o.name in bpy.data.objects:
                bpy.data.objects.remove(o, do_unlink=True)
    keep = {a.name for a in made}
    for a in list(bpy.data.actions):
        if a.name not in keep:
            bpy.data.actions.remove(a)
    for a in made:
        a.name = a["tfe_clip"]  # e.g. 'climb.001' -> 'climb' now that the source clip is gone
    retarget.push_to_nla(arm, made)
    for pb in arm.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    log("animations:", len(made), "clips;", "strides", meta["strides"])
    return meta


def render_pose_sheet(spec, arm, out_dir, clips=("idle", "walk", "run", "sprint", "jump", "land", "climb", "hang", "shimmy", "climb_up", "ledge_step", "vault", "interact", "sit")):
    """One frame from each clip (mid-clip), three-quarter view, for animation review."""
    os.makedirs(out_dir, exist_ok=True)
    scene = bpy.context.scene
    setup_lookdev_scene()
    cam_data = bpy.data.cameras.new("PoseCam")
    cam = bpy.data.objects.new("PoseCam", cam_data)
    bpy.context.collection.objects.link(cam)
    scene.camera = cam
    cam_data.lens = 40
    scene.render.resolution_x, scene.render.resolution_y = 560, 760
    target = Vector((0, 0, 0.95))
    cam.location = target + Vector((2.6, -3.6, 0.4))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    tracks = {t.name: t for t in arm.animation_data.nla_tracks}
    for clip in clips:
        act = bpy.data.actions.get(clip)
        if not act:
            continue
        for t in tracks.values():
            t.mute = True
        sys.path.insert(0, os.path.dirname(__file__))
        import retarget  # noqa: E402
        retarget.assign(arm, act)
        f0, f1 = act.frame_range
        scene.frame_set(int((f0 + f1) * 0.5))
        scene.render.filepath = os.path.join(out_dir, f"{spec['id']}_pose_{clip}.png")
        bpy.ops.render.render(write_still=True)
    arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    for o in [o for o in bpy.data.objects if o.type in {"LIGHT", "CAMERA"}]:
        bpy.data.objects.remove(o, do_unlink=True)
    log("pose sheet rendered")


# ------------------------------------------------------------------------------------- stage 4
TEX_LIMITS = {"body": 2048, "high-poly": 512, "teeth": 512, "tongue": 512, "eyebrow": 512, "eyelash": 512}


def export_glb(spec, arm, out_path):
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    objs = [arm] + [o for o in bpy.data.objects if o.type == "MESH" and o.parent == arm and not o.hide_render]
    # Texture budget: hero face/skin 2K, small parts 512, everything else 1K.
    done = set()
    for o in objs:
        if o.type != "MESH":
            continue
        limit = next((v for k, v in TEX_LIMITS.items() if k in o.name), 1024)
        for slot in o.material_slots:
            if not slot.material or not slot.material.use_nodes:
                continue
            for n in slot.material.node_tree.nodes:
                if n.type == "TEX_IMAGE" and n.image and n.image.name not in done:
                    w, h = n.image.size
                    if max(w, h) > limit:
                        n.image.scale(limit, int(h * limit / w))
                        n.image.pack()
                    done.add(n.image.name)
    # Alpha/culling modes for the browser renderer: only hair-like cards need alpha, and as an
    # alpha *test* (glTF MASK) so they sort and shadow correctly; skin and boots are single-sided.
    # Eyes too: the MakeHuman eye mesh has a transparent cornea shell over the iris.
    hair_like = ("hair", "short", "ponytail", "bob", "braid", "long", "afro", "eyebrow", "eyelash", "high-poly")
    single_sided = ("body", "high-poly", "teeth", "tongue", "shoes", "boot", "glasses")
    seen_mats = set()
    for o in objs:
        if o.type != "MESH":
            continue
        for slot in o.material_slots:
            m = slot.material
            if not m or m.name in seen_mats or not m.use_nodes:
                continue
            seen_mats.add(m.name)
            nt = m.node_tree
            bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
            if bsdf is None:
                continue
            alpha_links = list(bsdf.inputs["Alpha"].links)
            if any(k in o.name for k in hair_like) and alpha_links:
                src = alpha_links[0].from_socket
                nt.links.remove(alpha_links[0])
                clip = nt.nodes.new("ShaderNodeMath")
                clip.operation = "GREATER_THAN"
                clip.inputs[1].default_value = 0.35
                nt.links.new(src, clip.inputs[0])
                nt.links.new(clip.outputs[0], bsdf.inputs["Alpha"])
            else:
                for l in alpha_links:
                    nt.links.remove(l)
                bsdf.inputs["Alpha"].default_value = 1.0
            m.use_backface_culling = any(k in o.name for k in single_sided)
            # Sheen exports as a full-strength white sheenColor that greys dark cloth in three.js;
            # cloth softness comes from roughness + texture instead.
            if "Sheen Weight" in bsdf.inputs:
                bsdf.inputs["Sheen Weight"].default_value = 0.0
    for o in bpy.context.view_layer.objects:
        o.select_set(o in objs)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_skins=True,
        export_animations=True,
        export_animation_mode="NLA_TRACKS",
        export_image_format="WEBP",
        export_yup=True,
        export_morph=False,
    )
    log("exported", out_path, round(os.path.getsize(out_path) / 1e6, 2), "MB")


# ------------------------------------------------------------------------------------- previews
def setup_lookdev_scene():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 900
    scene.render.resolution_y = 1200
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    world = bpy.data.worlds.new("lookdev") if not scene.world else scene.world
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (0.2, 0.21, 0.22, 1)
    bg.inputs[1].default_value = 0.35

    def area(name, loc, energy, size, color):
        light = bpy.data.lights.new(name, "AREA")
        light.energy = energy
        light.size = size
        light.color = color
        obj = bpy.data.objects.new(name, light)
        obj.location = loc
        bpy.context.collection.objects.link(obj)
        direction = Vector((0, 0, 1.0)) - Vector(loc)
        obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        return obj

    # Classic 3-point portrait setup: warm key, cool fill, strong rim.
    area("Key", (2.2, -2.6, 2.4), 220, 2.0, (1.0, 0.9, 0.78))
    area("Fill", (-2.6, -1.8, 1.4), 55, 3.0, (0.78, 0.86, 1.0))
    area("Rim", (-0.6, 2.8, 2.6), 260, 1.5, (1.0, 0.95, 0.9))


def bounds(objs):
    """World bounds of what actually renders (evaluated meshes: MPFB helper geometry is masked)."""
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    dg = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        if o.type != "MESH" or o.hide_render:
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        mw = o.matrix_world
        for vert in me.vertices:
            w = mw @ vert.co
            lo.x, lo.y, lo.z = min(lo.x, w.x), min(lo.y, w.y), min(lo.z, w.z)
            hi.x, hi.y, hi.z = max(hi.x, w.x), max(hi.y, w.y), max(hi.z, w.z)
        ev.to_mesh_clear()
    log("bounds", tuple(round(v, 3) for v in lo), tuple(round(v, 3) for v in hi))
    return lo, hi


def render_previews(spec, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    scene = bpy.context.scene
    cam_data = bpy.data.cameras.new("PreviewCam")
    cam = bpy.data.objects.new("PreviewCam", cam_data)
    bpy.context.collection.objects.link(cam)
    scene.camera = cam
    lo, hi = bounds(character_objects())
    height = hi.z - lo.z
    cx, cy = (lo.x + hi.x) / 2, (lo.y + hi.y) / 2
    # Eye height is ~93.5% of standing height; frame the face around it.
    eye_z = lo.z + height * 0.935
    # (yaw degrees around the character; 0 = front, camera on -Y), lens mm, look height, distance
    shots = {
        "front": (0, 50, lo.z + height * 0.5, height * 2.05),
        "three_quarter": (35, 50, lo.z + height * 0.5, height * 2.05),
        "side": (90, 50, lo.z + height * 0.5, height * 2.05),
        "back": (180, 50, lo.z + height * 0.5, height * 2.05),
        "face": (12, 85, eye_z - 0.03, 0.62),
        "face_profile": (70, 85, eye_z - 0.03, 0.62),
    }
    for name, (yaw_deg, lens, look_z, dist) in shots.items():
        cam_data.lens = lens
        yaw = math.radians(yaw_deg)
        target = Vector((cx, cy, look_z))
        cam.location = target + Vector((math.sin(yaw) * dist, -math.cos(yaw) * dist, 0.02))
        cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(out_dir, f"{spec['id']}_{name}.png")
        bpy.ops.render.render(write_still=True)
        log("rendered", scene.render.filepath)


# ------------------------------------------------------------------------------------- main
def main():
    spec_path, previews_only = args()
    with open(spec_path, "r", encoding="utf-8") as f:
        spec = json.load(f)
    bpy.ops.wm.read_homefile(use_empty=True)
    basemesh = build_body(spec)
    ref_body = bake_and_cleanup(basemesh)
    # Garments sharing one texture atlas are split so each piece can get its own colour.
    for obj in [o for o in bpy.data.objects if o.type == "MESH" and "suit" in o.name]:
        garment = obj.name.split(".", 1)[-1]
        for part in separate_loose(obj):
            part["tfe_garment"] = garment
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    classify_garments()
    shorten_sleeves(spec, arm)
    tuck_trousers(spec, arm)
    hair = next((o for o in bpy.data.objects if o.type == "MESH" and o.name.endswith(spec["hair"].split("/")[0])), None)
    bunify_hair(hair, spec)
    apply_look(spec)
    brows = next((o for o in bpy.data.objects if o.type == "MESH" and spec.get("eyebrows", "?").split("/")[0] in o.name), None)
    paint_scar(spec, basemesh, brows)
    build_gear(spec, arm, ref_body)
    bpy.data.objects.remove(ref_body, do_unlink=True)
    setup_lookdev_scene()
    render_previews(spec, os.path.join(ROOT, "art", "characters", "previews", spec["id"]))
    blend_out = os.path.join(ROOT, "art", "characters", "source", f"{spec['id']}.blend")
    os.makedirs(os.path.dirname(blend_out), exist_ok=True)
    if previews_only:
        bpy.ops.wm.save_as_mainfile(filepath=blend_out)
        log("saved", blend_out)
        return
    # Lights/cameras are look-dev only.
    for o in [o for o in bpy.data.objects if o.type in {"LIGHT", "CAMERA"}]:
        bpy.data.objects.remove(o, do_unlink=True)
    meta = build_animations(spec, arm)
    render_pose_sheet(spec, arm, os.path.join(ROOT, "art", "characters", "previews", spec["id"]))
    bpy.ops.wm.save_as_mainfile(filepath=blend_out)
    log("saved", blend_out)
    out = os.path.join(ROOT, "public", "assets", "models", "characters", f"{spec['id']}.glb")
    export_glb(spec, arm, out)
    with open(os.path.join(ROOT, "art", "characters", f"{spec['id']}.meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)


if __name__ == "__main__":
    main()
