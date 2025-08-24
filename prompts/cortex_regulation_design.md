Please help me implement the Regulation Design mode.

For simplicity, we clone the code in MapCanvas.tsx to a new file called RegulationCanvas.tsx. But significant modifications on the new file would be needed.

# Basic Changes (with regard to the new page RegulationCanvas.tsx)
- When clicking on the Nav link "Regulations" on the Header, we activate the Regulation Design mode. In this mode, the Regulations link is highlighted in bright blue. The webpage navigates to the RegulationCanvas page.

- All the behaviors (interactions, events, displays) rest the same, except that: you don't show the planes anymore, and you don't show the waypoints as well (they are not relevant to the regulation design task).

- You clone LeftControl1.tsx to LeftControl1Regulation.tsx. The left panel is basically the same, but with only one subtle but important difference: when clicking in the hotspot, it pans to the hotspot and highlight it (like current behavior), but we open the Regulation Design panel (described below) instead of AirspaceInfo component.

- Clicking on **any airspace label** should open up the Regulation Design panel as well.

# Regulation Design Panel

- The Regulation Design panel should look like RightControl1.tsx in appearance (just the glassy appearance, the content will be VERY DIFFERENT). It shows the selected hotspot information such as the traffic volume id, altitude range. You also show the current count and the preset capacity (all respecting the current time state t in simStore.

- There is a small label text on top of the traffic volume ID that says: "Reference TV".

- Below that there is a place to select the Active Time Window (I'm not sure about how to aesthetically present a way to pick two moment: from, to; with ability to quickly set for 15m, 30m, 45m, 1h, 2h, 4h, 6h). Feel free to decide.

- Then you have a textbox with the label: Predicate Syntax or Flight List along with an "Enter" symbol staying on the right end of the textbox, prompting the user to enter the Predicate and hit Enter.

- Below that you have a table which shows the list of flights being targeted by the regulations. The parsing of the Predicate to flight list is not of concern right now. The user may enter a callsign of a flight an hit enter, and if it is a valid flight, it will be added to the targeted flight list.

- Clicking on any **flight line** on the map when this regulation design panel opens will add the flight to the flight list as well. 

- Remember there is a delete icon button for each flight to remove the flight from the flight list.

- Any flight selected by the flight list will have the flight line on the map turns "Bright Red".

- Then below the flight list you have the rate option, which is default set to the hourly capacity value.

- Then finally below all you have colored glassy button with icons: Preview Regulation.