// klipper-auto-eject - parts for a first test
// https://github.com/ahmedbebars/klipper-auto-eject
//
//   hollow_cube        a square ring with thin walls, like a cookie cutter.
//                      Print two or three, eject them, watch.
//   blade_gauge        a 1.5 mm strip to set the blade height: with the nozzle
//                      tip on the bed, the blade rests on the strip.
//   calibration_block  a low, solid block for AUTO_EJECT_CALIBRATE (Voron Tap
//                      and other probes that touch with the nozzle). Print it
//                      anywhere but the middle of the bed and leave it stuck
//                      there. It must stay lower than the fan duct, which sits
//                      only a few millimetres above the nozzle tip.
//                      Print it SOLID (100 % infill): the probe presses on it
//                      dozens of times. Measure right after the print, with
//                      the bed still warm (55 C at most) so it stays stuck.
//
// Copyright (C) 2026 Ahmed Bebars
// This file may be distributed under the terms of the GNU GPLv3 license.

/* [Part] */
part = "hollow_cube"; // [hollow_cube, calibration_block, blade_gauge]

/* [Hollow cube] */
cube_size = 25;
cube_height = 10;
wall = 1.6;

/* [Blade gauge] */
gauge_thickness = 1.5;

/* [Calibration block] */
block_size = 20;
block_height = 3.5;

if (part == "hollow_cube") {
    difference() {
        cube([cube_size, cube_size, cube_height]);
        translate([wall, wall, -1])
            cube([cube_size - 2 * wall, cube_size - 2 * wall, cube_height + 2]);
    }
} else if (part == "blade_gauge") {
    // a strip to slide under the blade while the nozzle sits on the bed
    difference() {
        cube([60, 20, gauge_thickness]);
        translate([30, 10, gauge_thickness - 0.6])
            linear_extrude(1)
                text(str(gauge_thickness, " mm"), size = 6, halign = "center", valign = "center");
    }
} else {
    cube([block_size, block_size, block_height]);
}
