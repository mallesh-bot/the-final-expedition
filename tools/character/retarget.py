"""
Animation retargeting for the character pipeline (Blender, no add-ons).

Method: rest-aligned world-space rotation transfer.
  For each mapped bone b and frame f:
    delta_b      = R_src_pose_world(b) * R_src_rest_world(b)^-1     (how the source bone moved)
    align_b      = swing taking the target rest direction onto the source rest direction
    R_tgt_world  = delta_b * align_b * R_tgt_rest_world(b)
  then converted to local pose rotations down the hierarchy. The pelvis translation is scaled by
  the hip-height ratio. Works between any two humanoid rigs with a bone-name map, regardless of
  rest pose (T-pose vs A-pose vs arms-down) or bone roll conventions.
"""
import bpy
from mathutils import Matrix, Quaternion, Vector


def import_gltf_armature(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in new if o.type == "ARMATURE")
    return arm, new


def world_rest(arm, name):
    return arm.matrix_world @ arm.data.bones[name].matrix_local


def bone_dir(arm, name):
    """Real limb direction: head -> child head (importers often guess tails, e.g. every bone
    pointing up). For branching bones (pelvis, chest) follow the spine/neck child."""
    b = arm.data.bones[name]
    head = arm.matrix_world @ b.head_local
    kids = list(b.children)
    if kids:
        pref = next((c for c in kids if any(k in c.name.lower() for k in ("spine", "neck", "chest", "head"))), None)
        c = pref or kids[0]
        d = (arm.matrix_world @ c.head_local) - head
        if d.length > 1e-5:
            return d.normalized()
    return ((arm.matrix_world @ b.tail_local) - head).normalized()


def auto_map(src, tgt, aliases=None):
    """Case-insensitive name match, plus explicit aliases {src_name: tgt_name}."""
    aliases = aliases or {}
    tnames = {b.name.lower(): b.name for b in tgt.data.bones}
    m = {}
    for b in src.data.bones:
        if b.name in aliases:
            t = tnames.get(aliases[b.name].lower())
            if t:
                m[b.name] = t
        elif b.name.lower() in tnames:
            m[b.name] = tnames[b.name.lower()]
    return m


def retarget_action(src, tgt, action, bone_map, out_name, hip_src="pelvis", hip_tgt="pelvis", fps_step=1.0, translate_hips=True):
    """Bake `action` (on armature `src`) onto `tgt` as a new action named `out_name`."""
    scene = bpy.context.scene
    assign(src, action)
    f0, f1 = (int(round(v)) for v in action.frame_range)

    inv_tgt_world = tgt.matrix_world.inverted()
    tgt_rot_world = tgt.matrix_world.to_quaternion()

    rev = {t: s for s, t in bone_map.items()}
    align, src_rest_q, tgt_rest_q = {}, {}, {}
    for s, t in bone_map.items():
        src_rest_q[s] = world_rest(src, s).to_quaternion()
        tgt_rest_q[t] = world_rest(tgt, t).to_quaternion()
    # Rest alignment from bone directions; leaf bones (hands, feet, head) have importer-guessed
    # tails, so they inherit their parent's alignment instead.
    for b in tgt.data.bones:
        t = b.name
        s = rev.get(t)
        if s is None:
            continue
        sb = src.data.bones[s]
        if sb.children and b.children:
            align[t] = bone_dir(tgt, t).rotation_difference(bone_dir(src, s))
        else:
            p = b.parent
            while p is not None and p.name not in align:
                p = p.parent
            align[t] = align[p.name] if p is not None else Quaternion()

    # Hip translation scale: target hip height / source hip height (world).
    s_hip0 = (src.matrix_world @ src.data.bones[hip_src].head_local) if hip_src in src.data.bones else None
    t_hip0 = (tgt.matrix_world @ tgt.data.bones[hip_tgt].head_local) if hip_tgt in tgt.data.bones else None
    ratio = (t_hip0.z / s_hip0.z) if (s_hip0 is not None and t_hip0 is not None and abs(s_hip0.z) > 1e-4) else 1.0

    # Target bones in hierarchy order.
    order = []

    def walk(b):
        order.append(b)
        for c in b.children:
            walk(c)

    for b in tgt.data.bones:
        if b.parent is None:
            walk(b)

    frames = []
    f = float(f0)
    while f <= f1 + 1e-6:
        frames.append(f)
        f += fps_step

    keys = {b.name: [] for b in order}
    hip_locs = []
    for fr in frames:
        scene.frame_set(int(fr), subframe=fr - int(fr))
        src_pose = {s: (src.matrix_world @ src.pose.bones[s].matrix) for s in bone_map}
        pose_arm = {}  # target armature-space pose matrices
        for b in order:
            rest_arm = b.matrix_local
            if b.parent:
                rest_rel = b.parent.matrix_local.inverted() @ rest_arm
                parent_pose = pose_arm[b.parent.name]
                frame_mat = parent_pose @ rest_rel
            else:
                frame_mat = rest_arm.copy()
            s = rev.get(b.name)
            if s is not None:
                delta = src_pose[s].to_quaternion() @ src_rest_q[s].inverted()
                r_world = delta @ align[b.name] @ tgt_rest_q[b.name]
                r_arm = tgt_rot_world.inverted() @ r_world
                loc = frame_mat.to_translation()
                if translate_hips and b.name == hip_tgt and s_hip0 is not None:
                    s_now = src_pose[s].to_translation()
                    loc = (inv_tgt_world @ (t_hip0 + (s_now - s_hip0) * ratio))
                target = Matrix.LocRotScale(loc, r_arm, Vector((1, 1, 1)))
            else:
                target = frame_mat
            basis = frame_mat.inverted() @ target
            pose_arm[b.name] = target
            keys[b.name].append(basis.to_quaternion())
            if b.name == hip_tgt:
                hip_locs.append(basis.to_translation())

    act = bpy.data.actions.new(out_name)
    act["tfe_clip"] = out_name  # final name, applied once source actions with the same name are gone
    act.use_fake_user = True
    n = len(frames)
    rel = [fr - frames[0] for fr in frames]
    for b in order:
        qs = keys[b.name]
        # Keep quaternions in one hemisphere so interpolation never flips.
        for i in range(1, len(qs)):
            if qs[i].dot(qs[i - 1]) < 0:
                qs[i] = -qs[i]
        if all(abs(q.angle) < 1e-4 for q in qs) and b.name != hip_tgt:
            continue
        path = f'pose.bones["{b.name}"].rotation_quaternion'
        for c in range(4):
            fc = act.fcurves.new(path, index=c, action_group=b.name)
            fc.keyframe_points.add(n)
            co = []
            for i in range(n):
                co += [rel[i] + 1, qs[i][c]]
            fc.keyframe_points.foreach_set("co", co)
            for kp in fc.keyframe_points:
                kp.interpolation = "LINEAR"
    if translate_hips and hip_locs:
        path = f'pose.bones["{hip_tgt}"].location'
        for c in range(3):
            fc = act.fcurves.new(path, index=c, action_group=hip_tgt)
            fc.keyframe_points.add(n)
            co = []
            for i in range(n):
                co += [rel[i] + 1, hip_locs[i][c]]
            fc.keyframe_points.foreach_set("co", co)
            for kp in fc.keyframe_points:
                kp.interpolation = "LINEAR"
    return act


def measure_stride(arm, action, root_name):
    """Metres travelled by the root bone over one loop of a root-motion clip."""
    scene = bpy.context.scene
    assign(arm, action)
    f0, f1 = (int(round(v)) for v in action.frame_range)
    scene.frame_set(f0)
    p0 = (arm.matrix_world @ arm.pose.bones[root_name].matrix).to_translation()
    scene.frame_set(f1)
    p1 = (arm.matrix_world @ arm.pose.bones[root_name].matrix).to_translation()
    d = p1 - p0
    return (d.x ** 2 + d.y ** 2) ** 0.5, (f1 - f0) / scene.render.fps


def assign(arm, act):
    """Assign an action (Blender 4.4+ slotted actions need the slot set explicitly)."""
    arm.animation_data_create()
    arm.animation_data.action = act
    if act is not None and hasattr(arm.animation_data, "action_slot") and len(getattr(act, "slots", [])):
        arm.animation_data.action_slot = act.slots[0]


def push_to_nla(arm, actions):
    """Each action becomes its own NLA track so the glTF exporter writes one clip per action."""
    arm.animation_data_create()
    arm.animation_data.action = None
    for act in actions:
        tr = arm.animation_data.nla_tracks.new()
        tr.name = act.name
        st = tr.strips.new(act.name, int(act.frame_range[0]), act)
        st.name = act.name
        if hasattr(st, "action_slot") and len(getattr(act, "slots", [])):
            st.action_slot = act.slots[0]
        tr.mute = True
