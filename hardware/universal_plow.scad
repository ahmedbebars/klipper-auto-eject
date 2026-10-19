// klipper-auto-eject - universal blade (plow)
// https://github.com/ahmedbebars/klipper-auto-eject
//
// Three parts joined with M3 screws and nuts. Slots in each joint let one
// design fit most toolheads:
//
//   mount ──(vertical slots: blade height)── arm ──(horizontal slots: reach)── blade
//
//   mount  bolts to the front of the toolhead. Its screw slots fit any
//          hole spacing from mount_spacing_min to mount_spacing_max, or
//          choose the strap version for toolheads without usable screws.
//   arm    hangs down in front of the toolhead. Its slots set the blade
//          height (+/- arm_slot_len / 2).
//   blade  pushes the parts. Its tab slots set how far it reaches ahead.
//
// Exact height and reach do not matter: AUTO_EJECT_SETUP measures them
// after mounting. Get the blade's lower edge roughly 1-2 mm above the
// nozzle tip and its face ahead of everything else on the toolhead.
//
// Choose a part with the "part" parameter (Customizer or -D part="..."),
// render, export STL. Parts are already oriented for printing.
// PETG/ABS/ASA, 4 walls, 40 % infill.
//
// Copyright (C) 2026 Ahmed Bebars
// This file may be distributed under the terms of the GNU GPLv3 license.

/* [Part] */
// Which part to render
part = "assembly"; // [assembly, blade, arm, mount_screws, mount_strap]

/* [Blade] */
// Blade width across the push direction (60, 80, 100 ...)
blade_width = 80;
// Blade height
blade_height = 14;
// Blade thickness
blade_thickness = 3;
// Chamfer on the lower front edge so it rides over small bumps
blade_chamfer = 1.2;
// Length of the tab that bolts to the arm
tab_length = 34;

/* [Arm] */
// Arm height (distance the blade hangs below the mount)
arm_height = 55;
// Length of the height-adjustment slots
arm_slot_len = 30;
// Length of the arm's foot (holds the blade tab)
foot_length = 22;

/* [Mount] */
// Smallest toolhead screw spacing the mount must fit
mount_spacing_min = 24;
// Largest toolhead screw spacing the mount must fit
mount_spacing_max = 50;
// Mount plate height
mount_height = 18;
// Mount plate thickness
mount_thickness = 5;
// Strap slot width (strap version)
strap_width = 12;

/* [Hardware] */
// Screw clearance hole (M3 = 3.4)
screw_d = 3.4;
// Screw head diameter for counterbores
screw_head_d = 6.2;
// Nut across corners (M3 = 6.4) for nut traps
nut_d = 6.4;
// Nut trap depth
nut_depth = 2.6;

/* [Hidden] */
$fn = 40;
eps = 0.01;
plate = 4;          // thickness of arm and tab plates
link_w = 20;        // width of the arm and the blade tab
link_x = 5;         // screws at x = +/- link_x in every joint

// ----------------------------------------------------------------- helpers
// slot along +Y of length l (centre to centre), through a plate of height h
module slot_y(l, d, h) {
    hull() for (y = [0, l]) translate([0, y, -eps]) cylinder(d = d, h = h + 2 * eps);
}
// slot along +Z of length l, through a plate lying in XZ (thickness along Y)
module slot_z(l, d, t) {
    hull() for (z = [0, l]) translate([0, -eps, z]) rotate([-90, 0, 0]) cylinder(d = d, h = t + 2 * eps);
}
// slot along +X of length l, through a plate lying in XZ
module slot_x(l, d, t) {
    hull() for (x = [0, l]) translate([x, -eps, 0]) rotate([-90, 0, 0]) cylinder(d = d, h = t + 2 * eps);
}

// ------------------------------------------------------------------- blade
// Modelled in place: face at y = 0 pointing -Y, lower edge at z = 0.
module blade() {
    difference() {
        union() {
            // pushing plate
            translate([-blade_width / 2, 0, 0])
                cube([blade_width, blade_thickness, blade_height]);
            // tab on top, reaching back toward the arm
            translate([-link_w / 2, 0, blade_height - plate])
                cube([link_w, tab_length, plate]);
            // gussets
            for (x = [-link_w / 2, link_w / 2 - 3])
                hull() {
                    translate([x, blade_thickness - eps, blade_height - plate])
                        cube([3, 12, plate]);
                    translate([x, blade_thickness - eps, 0])
                        cube([3, 0.5, blade_height]);
                }
        }
        // reach-adjustment slots
        for (x = [-link_x, link_x])
            translate([x, blade_thickness + 8, blade_height - plate])
                slot_y(tab_length - 14, screw_d, plate);
        // chamfer the lower front edge
        translate([-blade_width / 2 - 1, 0, 0])
            rotate([45, 0, 0])
                cube([blade_width + 2, blade_chamfer * 1.414, blade_chamfer * 1.414], center = true);
    }
}

// --------------------------------------------------------------------- arm
// Modelled in place: foot sits on the blade tab, upright rises behind it.
module arm() {
    difference() {
        union() {
            // foot, lying on the blade tab
            translate([-link_w / 2, 0, 0]) cube([link_w, foot_length, plate]);
            // upright at the back end of the foot
            translate([-link_w / 2, foot_length - plate, 0]) cube([link_w, plate, arm_height]);
            // gusset between foot and upright
            for (x = [-link_w / 2, link_w / 2 - 3])
                hull() {
                    translate([x, foot_length - plate - 10, plate - eps]) cube([3, 10, 0.5]);
                    translate([x, foot_length - plate - 0.5, plate - eps]) cube([3, 0.5, 12]);
                }
        }
        // foot holes: screws through the foot into the blade tab slots
        for (x = [-link_x, link_x])
            translate([x, 6, -eps]) cylinder(d = screw_d, h = plate + 2 * eps);
        // height-adjustment slots in the upright
        for (x = [-link_x, link_x])
            translate([x, foot_length - plate, arm_height - 6 - arm_slot_len])
                slot_z(arm_slot_len, screw_d, plate);
    }
}

// ------------------------------------------------------------------ mounts
// Modelled in place: back face at y = 0 (against the toolhead), front at
// y = -mount_thickness. The arm upright bolts to the front.
module mount_body() {
    translate([-max(mount_spacing_max / 2 + 8, link_w / 2 + 14), -mount_thickness, 0])
        cube([2 * max(mount_spacing_max / 2 + 8, link_w / 2 + 14), mount_thickness, mount_height]);
}

module arm_holes() {
    // arm screws, with nut traps on the back face
    for (x = [-link_x, link_x]) {
        translate([x, -mount_thickness - eps, mount_height / 2]) rotate([-90, 0, 0])
            cylinder(d = screw_d, h = mount_thickness + 2 * eps);
        translate([x, -nut_depth, mount_height / 2]) rotate([-90, 0, 0])
            cylinder(d = nut_d, h = nut_depth + eps, $fn = 6);
    }
}

module mount_screws() {
    lo = max(mount_spacing_min / 2, link_w / 2 + screw_head_d / 2 + 1);
    hi = mount_spacing_max / 2;
    difference() {
        mount_body();
        arm_holes();
        for (s = [-1, 1]) {
            // slots for the toolhead screws, counterbored from the front
            translate([s > 0 ? lo : -hi, -mount_thickness, mount_height / 2])
                slot_x(hi - lo, screw_d, mount_thickness);
            translate([s > 0 ? lo : -hi, -mount_thickness - eps, mount_height / 2])
                hull() for (x = [0, hi - lo]) translate([x, 0, 0]) rotate([-90, 0, 0])
                    cylinder(d = screw_head_d, h = 1.8);
        }
    }
}

module mount_strap() {
    w = 2 * max(mount_spacing_max / 2 + 8, link_w / 2 + 14);
    difference() {
        mount_body();
        arm_holes();
        // strap / cable-tie slots near both ends
        for (x = [-w / 2 + 5, w / 2 - 5 - 3])
            translate([x, -mount_thickness - eps, (mount_height - strap_width) / 2])
                cube([3, mount_thickness + 2 * eps, strap_width]);
    }
}

// --------------------------------------------------------------- assembly
module assembly() {
    reach = 6;   // where the foot sits along the tab slots
    color("orange") blade();
    color("steelblue") translate([0, blade_thickness + 8 + reach, blade_height]) arm();
    color("gray")
        // the mount's front face rests against the back of the arm upright
        translate([0, blade_thickness + 8 + reach + foot_length + mount_thickness,
                   blade_height + arm_height - 6 - arm_slot_len / 2 - mount_height / 2])
            mount_screws();
}

// ------------------------------------------------- print orientations
if (part == "assembly") {
    assembly();
} else if (part == "blade") {
    // upside down: the tab lies on the bed, the plate stands up from it
    rotate([180, 0, 0]) translate([0, 0, -blade_height]) blade();
} else if (part == "arm") {
    // upright flat on the bed so its layers run along its length
    rotate([-90, 0, 0]) translate([0, -foot_length, 0]) arm();
} else if (part == "mount_screws") {
    // back face (with the nut traps) on the bed
    rotate([-90, 0, 0]) mount_screws();
} else if (part == "mount_strap") {
    rotate([-90, 0, 0]) mount_strap();
}
