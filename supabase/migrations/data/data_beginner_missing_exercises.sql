-- Missing exercises for AHS Beginner Program
-- Run BEFORE ahs_beginner_program.sql

INSERT INTO public.lifting_exercise_bank (name, muscle_group, video_url, default_rest_secs) VALUES
('DB Bench Press',          'Chest',    'https://youtube.com/watch?v=VmB1G1K7v94', 120),
('Cable Face Pull',         'Back',     'https://youtube.com/watch?v=V8dZ3pyiCBo', 60),
('KB/TB Deadlift',          'Legs',     'https://youtube.com/watch?v=p4C7LWRNnc0', 150),
('DB Row',                  'Back',     'https://youtube.com/watch?v=pYcpY20QaE8', 90),
('DB Shoulder Press',       'Shoulders','https://youtube.com/watch?v=qEwKCR5JCog', 90),
('DB Single Arm Split Jerk','Athletic', 'https://youtube.com/watch?v=SmGGZ-sNXQ4', 120),
('DB 4-Way Squat',          'Legs',     'https://youtube.com/watch?v=MeIiIdhvXT4', 90),
('Paloff Press',            'Core',     'https://youtube.com/watch?v=AH_QZLm_0-s', 60),
('Paloff Hold and Press',   'Core',     'https://youtube.com/watch?v=AH_QZLm_0-s', 60),
('Wall Sit',                'Legs',     'https://youtube.com/watch?v=JDFApiQqPHo', 60),
('Bar Hang',                'Back',     'https://youtube.com/watch?v=CAwf7n6Luuc', 60),
('Cardio (Jog/Bike)',       'Athletic', 'https://youtube.com/watch?v=6vMkxlIFVAQ', 60),
('Approach Jumps',          'Athletic', 'https://youtube.com/watch?v=52lowV7_oSo', 90),
('Court Laps',              'Athletic', 'https://youtube.com/watch?v=6vMkxlIFVAQ', 60),
('Full Court Sprints',      'Athletic', 'https://youtube.com/watch?v=6vMkxlIFVAQ', 90),
('Bounds',                  'Athletic', 'https://youtube.com/watch?v=HNl0S0tqOek', 90),
('Box React Drill',         'Athletic', 'https://youtube.com/watch?v=YkP_RlXSt4s', 60),
('17s Conditioning Test',   'Athletic', 'https://youtube.com/watch?v=6vMkxlIFVAQ', 120),
('Farmers Carry',           'Core',     'https://youtube.com/watch?v=AH_QZLm_0-s', 60),
('Suitcase Carry',          'Core',     'https://youtube.com/watch?v=AH_QZLm_0-s', 60)
ON CONFLICT (name) DO NOTHING;
