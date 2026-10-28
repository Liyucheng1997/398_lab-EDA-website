`timescale 1ns / 1ps

// ULX3S LED 与按键演示：8 个 LED 显示 4 种动画，用板上 6 个按键和 4 位拨码开关控制。
//
//   按键（按下为 1，均已消抖）：
//     F1    暂停 / 继续          F2     切换动画：流水 → 往返 → 计数 → 进度条
//     UP    加速（共 4 档）       DOWN   减速
//     LEFT  向 led[7] 方向运动    RIGHT  向 led[0] 方向运动
//     PWR   复位（低有效，rst_n）
//   拨码开关：
//     SW1 = sw[0] 取反显示        SW2 = sw[1] 左右镜像
//     SW3 = sw[2] 25% 亮度        SW4 = sw[3] LED 直接显示 6 个按键的状态（调试）
module ulx3s_demo #(
  parameter CLK_HZ      = 25_000_000,  // 输入时钟频率（Hz）
  parameter DEBOUNCE_MS = 10           // 按键消抖时间（ms）
) (
  input  logic       clk,              // 25 MHz
  input  logic       rst_n,            // PWR 键，按下为 0
  input  logic [5:0] btn,              // F1 F2 UP DOWN LEFT RIGHT
  input  logic [3:0] sw,
  output logic [7:0] led
);
  localparam DB_CYCLES = (CLK_HZ * DEBOUNCE_MS / 1000 > 1) ? CLK_HZ * DEBOUNCE_MS / 1000 : 1;
  localparam STEP_BASE = (CLK_HZ / 2 > 8) ? CLK_HZ / 2 : 8;   // 速度 0：每 0.5 s 一步
  localparam TW        = $clog2(STEP_BASE + 1);

  localparam B_F1 = 0, B_F2 = 1, B_UP = 2, B_DOWN = 3, B_LEFT = 4, B_RIGHT = 5;

  // ───────── 复位同步：异步按下，同步释放 ─────────
  logic rst_s0 = 1'b1, rst = 1'b1;
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      rst_s0 <= 1'b1;
      rst    <= 1'b1;
    end else begin
      rst_s0 <= 1'b0;
      rst    <= rst_s0;
    end
  end

  // ───────── 按键消抖 ─────────
  logic [5:0] b_level, b_press;
  genvar gi;
  generate
    for (gi = 0; gi < 6; gi = gi + 1) begin : g_btn
      debounce #(.CYCLES(DB_CYCLES)) u_db (.clk(clk), .in(btn[gi]), .out(b_level[gi]), .rise(b_press[gi]));
    end
  endgenerate

  // ───────── 控制寄存器 ─────────
  logic       paused;
  logic [1:0] pattern;   // 0 流水，1 往返，2 计数，3 进度条
  logic [1:0] speed;     // 0~3：每秒 2、4、8、16 步
  logic       dir;       // 1 = 向 led[7]，0 = 向 led[0]

  always_ff @(posedge clk) begin
    if (rst) begin
      paused  <= 1'b0;
      pattern <= 2'd0;
      speed   <= 2'd1;
      dir     <= 1'b1;
    end else begin
      if (b_press[B_F1])                      paused  <= ~paused;
      if (b_press[B_F2])                      pattern <= pattern + 2'd1;
      if (b_press[B_UP]   && speed != 2'd3)   speed   <= speed + 2'd1;
      if (b_press[B_DOWN] && speed != 2'd0)   speed   <= speed - 2'd1;
      if (b_press[B_LEFT])                    dir     <= 1'b1;
      if (b_press[B_RIGHT])                   dir     <= 1'b0;
    end
  end

  // ───────── 步进定时器 ─────────
  logic [TW-1:0] tcnt;
  logic [TW-1:0] period;
  logic          step;

  assign period = TW'(STEP_BASE) >> speed;
  assign step   = (tcnt >= period - 1'b1);

  always_ff @(posedge clk) begin
    if (rst || step) tcnt <= '0;
    else             tcnt <= tcnt + 1'b1;
  end

  // ───────── 动画状态（四种动画同时推进，显示时再选择） ─────────
  logic [2:0] pos;        // 流水灯位置
  logic [2:0] bpos;       // 往返灯位置
  logic       bup;        // 往返方向
  logic [7:0] cnt;        // 计数值
  logic [3:0] level;      // 进度条长度 0~8

  always_ff @(posedge clk) begin
    if (rst) begin
      pos   <= 3'd0;
      bpos  <= 3'd0;
      bup   <= 1'b1;
      cnt   <= 8'd0;
      level <= 4'd0;
    end else if (step && !paused) begin
      pos <= dir ? pos + 3'd1 : pos - 3'd1;

      if (bup) begin
        if (bpos == 3'd7) begin bup <= 1'b0; bpos <= 3'd6; end
        else              bpos <= bpos + 3'd1;
      end else begin
        if (bpos == 3'd0) begin bup <= 1'b1; bpos <= 3'd1; end
        else              bpos <= bpos - 3'd1;
      end

      cnt <= dir ? cnt + 8'd1 : cnt - 8'd1;

      if (dir) level <= (level == 4'd8) ? 4'd0 : level + 4'd1;
      else     level <= (level == 4'd0) ? 4'd8 : level - 4'd1;
    end
  end

  // ───────── 显示 ─────────
  logic [7:0] fill, pat, mirrored, shown;
  logic [1:0] pwm = 2'd0;

  assign fill = (level >= 4'd8) ? 8'hFF : (8'd1 << level) - 8'd1;

  always_ff @(posedge clk) pwm <= pwm + 2'd1;   // 4 拍中只亮 1 拍 => 25% 亮度

  always_comb begin
    case (pattern)
      2'd0:    pat = 8'd1 << pos;
      2'd1:    pat = 8'd1 << bpos;
      2'd2:    pat = cnt;
      default: pat = fill;
    endcase
  end

  assign mirrored = sw[1] ? {pat[0], pat[1], pat[2], pat[3], pat[4], pat[5], pat[6], pat[7]} : pat;
  assign shown    = sw[0] ? ~mirrored : mirrored;

  assign led = sw[3] ? {2'b00, b_level}
                     : (sw[2] && pwm != 2'd0) ? 8'd0 : shown;
endmodule
