// klipper-auto-eject - parametric blade (plow)
// https://github.com/ahmedbebars/klipper-auto-eject
//
// A starting point, not a drop-in part: every toolhead is different.
// Measure your toolhead, set the parameters below, render, and check the
// fit before printing. Print in PETG/ABS/ASA, 4+ walls, 40% infill, with the
// blade face standing upright on the bed.
//
// Copyright (C) 2026 Ahmed Bebars
// This file may be distributed under the terms of the GNU GPLv3 license.

/* [Mount] */
// Spacing between the two mounting screws (mm)
screw_spacing = 30;
// Screw diameter (M3 = 3.2 clearance)
screw_d = 3.2;
// Screw head diameter (for the counterbore)
screw_head_d = 6.0;
// Mount plate width (mm)
mount_width = 42;
// Mount plate height (mm)
mount_height = 14;
// Mount plate thickness (mm)
mount_thickness = 4;

/* [Geometry] */
// Vertical distance from the screw centres down to the nozzle tip (mm)
screws_above_nozzle = 35;
// Gap between the blade's lower edge and the nozzle tip (mm, positive = blade higher)
blade_lift = 1.5;
// How far the blade face sits in front of the mount plate (mm)
blade_reach = 12;

/* [Blade] */
// Blade width (mm) - set blade_width in auto_eject_settings.cfg to match
blade_width = 80;
// Blade height (mm)
blade_height = 12;
// Blade thickness (mm)
blade_thickness = 3;
// Chamfer on the lower front edge so it rides over small bumps (mm)
edge_chamfer = 1.0;

$fn = 48;

arm_length = screws_above_nozzle - blade_lift - blade_height + mount_height / 2;

module mount_plate() {
    difference() {
        translate([-mount_width / 2, 0, -mount_height / 2])
            cube([mount_width, mount_thickness, mount_height]);
        for (x = [-screw_spacing / 2, screw_spacing / 2]) {
            translate([x, -1, 0]) rotate([-90, 0, 0])
                cylinder(d = screw_d, h = mount_thickness + 2);
            translate([x, mount_thickness - 1.6, 0]) rotate([-90, 0, 0])
                cylinder(d = screw_head_d, h = 2);
        }
    }
}

module arm() {
    // two ribs from the plate down to the blade
    for (x = [-mount_width / 2, mount_width / 2 - 4])
        hull() {
            translate([x, 0, -mount_height / 2]) cube([4, mount_thickness, 1]);
            translate([x, -blade_reach, -mount_height / 2 - arm_length])
                cube([4, blade_reach + mount_thickness, 1]);
        }
}

module blade() {
    z0 = -mount_height / 2 - arm_length - blade_height;
    difference() {
        translate([-blade_width / 2, -blade_reach - blade_thickness, z0])
            cube([blade_width, blade_thickness + blade_reach / 2, blade_height]);
        // chamfer the lower front edge
        translate([-blade_width / 2 - 1, -blade_reach - blade_thickness, z0])
            rotate([45, 0, 0])
                cube([blade_width + 2, edge_chamfer * 1.42, edge_chamfer * 1.42]);
    }
}

union() {
    mount_plate();
    arm();
    blade();
}
