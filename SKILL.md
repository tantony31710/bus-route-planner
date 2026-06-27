###
title: Bus Route Planner Skill
description: Calculates optimal transit routes, schedules, and connections between stops.
tools:
  - execute_route_calculation
---

# Bus Route Planner Skill

## Purpose
This skill allows the agent to calculate, optimize, and display efficient transit paths using local bus schedules, GPS coordinates, and stop identifiers.

## Guidelines & Usage
* Use this skill whenever a user asks to plan a trip between two geographic points or transit stops.
* Always prioritize routes with the lowest total travel time, factoring in walking transfers.
* If a direct route is unavailable, provide a multi-stop itinerary with exact transfer points.

## Example Prompts
* "Find the fastest bus route from Central Station to the Airport."
* "How do I get to the stadium by bus before 7:00 PM tonight?"
