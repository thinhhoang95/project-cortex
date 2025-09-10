Can you help me plan for another view, called Occupancy/Original to add in the barchart views: currently you have Demand (Rate), Occupancy and Occupancy All, this will be the fourth mode.

The idea is that in the Occupancy mode we have the occupancy count of the given **flows**, but it would be helpful to have a stacked-bar chart to show the account of the flows over the **total occupancy**.

This will require heavy planning, as I am aware of the `original_count/page.tsx` allows us to retrieve the total occupancy count, and the Occupancy mode view of `flow-evaluation/page.tsx` does contain the code on how to retrieve each flow's occupancy count.

Can you help plan for the steps required to realize the task?